import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import {
	ASSET_TRANSFER_HOST,
	ASSET_TRANSFER_PORT_START,
	getAssetTransferDiscoveryPorts,
} from '../../src/utils/asset-localization-protocol';

export const STAGED_JOB_TTL_MS = 10 * 60 * 1000;

export interface StagedAsset {
	key: string;
	finalUrl?: string;
	data: ArrayBuffer;
	declaredMimeType?: string;
	contentDisposition?: string;
}

export interface TransferServerStatus {
	state: 'starting' | 'running' | 'error' | 'stopped';
	host: string;
	port: number;
	error?: string;
}

interface StagedJob {
	assets: Map<string, StagedAsset>;
	timer: ReturnType<typeof setTimeout>;
}

export class AssetTransferServer {
	private server: Server | null = null;
	private jobs = new Map<string, StagedJob>();
	private status: TransferServerStatus;

	constructor(
		private readonly vaultName: () => string,
		private readonly requestedPort?: number,
		private readonly getLastFocusedAt: () => number = () => 0,
		private readonly discoveryPorts: number[] = getAssetTransferDiscoveryPorts(),
	) {
		this.status = {
			state: 'stopped',
			host: ASSET_TRANSFER_HOST,
			port: requestedPort ?? ASSET_TRANSFER_PORT_START,
		};
	}

	async start(): Promise<void> {
		if (this.server) throw new Error('The asset transfer server has already been started.');
		const candidatePorts = this.requestedPort === undefined
			? this.discoveryPorts
			: [this.requestedPort];

		for (const port of candidatePorts) {
			this.status = { state: 'starting', host: ASSET_TRANSFER_HOST, port };
			try {
				const server = await this.listenOnPort(port);
				this.server = server;
				server.on('error', error => {
					this.status = {
						state: 'error',
						host: ASSET_TRANSFER_HOST,
						port: this.getBoundPort(),
						error: error.message,
					};
					console.error('[Web Clipper Companion] Transfer server error', error);
				});
				this.status = { state: 'running', host: ASSET_TRANSFER_HOST, port: this.getBoundPort() };
				return;
			} catch (error) {
				if (this.requestedPort === undefined && isAddressInUseError(error)) continue;
				this.status = { state: 'error', host: ASSET_TRANSFER_HOST, port, error: errorMessage(error) };
				throw error;
			}
		}

		const error = new Error(`No free companion service port is available in ${candidatePorts[0]}–${candidatePorts[candidatePorts.length - 1]}.`);
		this.status = {
			state: 'error',
			host: ASSET_TRANSFER_HOST,
			port: candidatePorts[candidatePorts.length - 1],
			error: error.message,
		};
		throw error;
	}

	async stop(): Promise<void> {
		for (const job of this.jobs.values()) clearTimeout(job.timer);
		this.jobs.clear();
		const server = this.server;
		this.server = null;
		if (server) {
			await new Promise<void>((resolve, reject) => {
				server.close(error => error ? reject(error) : resolve());
			});
		}
		this.status = { state: 'stopped', host: ASSET_TRANSFER_HOST, port: this.status.port };
	}

	getStatus(): TransferServerStatus {
		return { ...this.status };
	}

	takeJob(jobId: string): Map<string, StagedAsset> {
		const job = this.jobs.get(jobId);
		if (!job) return new Map();
		clearTimeout(job.timer);
		this.jobs.delete(jobId);
		return job.assets;
	}

	private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const url = new URL(request.url || '/', `http://${ASSET_TRANSFER_HOST}:${this.getBoundPort()}`);
		const origin = request.headers.origin || '';
		if (!isAllowedExtensionRequest(request, url, origin)) {
			this.writeJson(response, 403, { ok: false, error: 'Companion requests are accepted only from browser extension origins.' });
			return;
		}
		if (origin) this.setCorsHeaders(response, origin);
		if (request.method === 'OPTIONS') {
			response.writeHead(204);
			response.end();
			return;
		}

		if (request.method === 'GET' && url.pathname === '/health') {
			this.writeJson(response, 200, {
				ok: true,
				service: 'obsidian-web-clipper-companion',
				version: '1.1.0',
				host: ASSET_TRANSFER_HOST,
				port: this.getBoundPort(),
				vault: this.vaultName(),
				lastFocusedAt: this.getLastFocusedAt(),
			});
			return;
		}

		const match = /^\/v1\/jobs\/([^/]+)\/assets\/([^/]+)$/.exec(url.pathname);
		if (request.method !== 'POST' || !match) {
			this.writeJson(response, 404, { ok: false, error: 'Unknown asset transfer endpoint.' });
			return;
		}

		const jobId = decodeURIComponent(match[1]);
		if (!/^[A-Za-z0-9-]{1,128}$/.test(jobId)) {
			this.writeJson(response, 400, { ok: false, error: 'Invalid asset transfer job ID.' });
			return;
		}
		const assetKey = decodeURIComponent(match[2]);
		if (!/^[A-Za-z0-9-]{1,128}$/.test(assetKey)) {
			this.writeJson(response, 400, { ok: false, error: 'Invalid asset transfer key.' });
			return;
		}

		const declaredMimeType = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
		if (declaredMimeType && declaredMimeType !== 'application/octet-stream' && !declaredMimeType.startsWith('image/')) {
			this.writeJson(response, 415, {
				ok: false,
				error: `Browser returned non-image content ${declaredMimeType}. The resource may require a different login session.`,
			});
			return;
		}

		const data = await readRequestBody(request);
		const asset: StagedAsset = {
			key: assetKey,
			finalUrl: decodeHeader(request.headers['x-web-clipper-final-url']),
			data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
			declaredMimeType,
			contentDisposition: decodeHeader(request.headers['x-web-clipper-content-disposition']),
		};
		this.stageAsset(jobId, asset);
		this.writeJson(response, 201, { ok: true });
	}

	private stageAsset(jobId: string, asset: StagedAsset): void {
		let job = this.jobs.get(jobId);
		if (!job) {
			const timer = setTimeout(() => {
				this.jobs.delete(jobId);
				console.warn(`[Web Clipper Companion] Expired staged asset job ${jobId}.`);
			}, STAGED_JOB_TTL_MS);
			job = { assets: new Map(), timer };
			this.jobs.set(jobId, job);
		}
		job.assets.set(asset.key, asset);
	}

	private getBoundPort(): number {
		const address = this.server?.address();
		return address && typeof address === 'object' ? (address as AddressInfo).port : this.status.port;
	}

	private listenOnPort(port: number): Promise<Server> {
		const server = createServer((request, response) => {
			void this.handleRequest(request, response).catch(error => {
				console.error('[Web Clipper Companion] Transfer request failed', error);
				if (!response.headersSent) {
					this.writeJson(response, 500, { ok: false, error: errorMessage(error) });
				} else {
					response.destroy(error instanceof Error ? error : new Error(String(error)));
				}
			});
		});
		return new Promise<Server>((resolve, reject) => {
			const onError = (error: Error) => {
				server.off('listening', onListening);
				reject(error);
			};
			const onListening = () => {
				server.off('error', onError);
				resolve(server);
			};
			server.once('error', onError);
			server.once('listening', onListening);
			server.listen(port, ASSET_TRANSFER_HOST);
		});
	}

	private setCorsHeaders(response: ServerResponse, origin: string): void {
		response.setHeader('Access-Control-Allow-Origin', origin);
		response.setHeader('Vary', 'Origin');
		response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		response.setHeader(
			'Access-Control-Allow-Headers',
			'Content-Type, X-Web-Clipper-Probe, X-Web-Clipper-Content-Disposition, X-Web-Clipper-Final-Url',
		);
	}

	private writeJson(response: ServerResponse, status: number, value: Record<string, unknown>): void {
		response.statusCode = status;
		response.setHeader('Content-Type', 'application/json; charset=utf-8');
		response.end(JSON.stringify(value));
	}
}

function isAllowedExtensionOrigin(origin: string): boolean {
	return /^(?:chrome-extension|moz-extension|safari-web-extension):\/\/[A-Za-z0-9._-]+$/i.test(origin);
}

function isAllowedExtensionRequest(request: IncomingMessage, url: URL, origin: string): boolean {
	if (isAllowedExtensionOrigin(origin)) return true;

	// Privileged extension background GET requests may omit Origin when the
	// extension has host permissions. Ordinary web pages cannot send this custom
	// header cross-origin without an Origin-bearing preflight, which is rejected.
	return origin === ''
		&& request.method === 'GET'
		&& url.pathname === '/health'
		&& request.headers['x-web-clipper-probe'] === '1';
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

function decodeHeader(value: string | string[] | undefined): string | undefined {
	const raw = Array.isArray(value) ? value[0] : value;
	if (!raw) return undefined;
	try {
		return decodeURIComponent(raw);
	} catch {
		throw new Error('Asset transfer request contains an invalid encoded header.');
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isAddressInUseError(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'EADDRINUSE');
}
