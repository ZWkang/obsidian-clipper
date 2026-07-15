export const ASSET_LOCALIZATION_PROTOCOL_VERSION = 2 as const;
export const ASSET_TRANSFER_HOST = '127.0.0.1';
export const ASSET_TRANSFER_PORT_START = 27123;
export const ASSET_TRANSFER_PORT_END = 27223;

export function buildAssetTransferBaseUrl(port: number): string {
	return `http://${ASSET_TRANSFER_HOST}:${port}`;
}

export function getAssetTransferDiscoveryPorts(): number[] {
	return Array.from(
		{ length: ASSET_TRANSFER_PORT_END - ASSET_TRANSFER_PORT_START + 1 },
		(_, index) => ASSET_TRANSFER_PORT_START + index,
	);
}

export type BodyImageReferenceKind = 'markdown-image' | 'markdown-image-reference' | 'html-image';

export interface BodyImageReference {
	kind: BodyImageReferenceKind;
	url: string;
	alt: string;
	start: number;
	end: number;
	raw: string;
}

export interface PropertyImageReference {
	propertyName: string;
	url: string;
	listIndex?: number;
}

export interface AssetTransferFailure {
	url: string;
	message: string;
}

export interface AssetTransferReference {
	url: string;
	key: string;
}

export interface AssetLocalizationJobV2 {
	version: typeof ASSET_LOCALIZATION_PROTOCOL_VERSION;
	id: string;
	bodyReferences: BodyImageReference[];
	propertyReferences: PropertyImageReference[];
	transfers: AssetTransferReference[];
	transferFailures: AssetTransferFailure[];
}

export interface ParsedAssetLocalizationEnvelope {
	job: AssetLocalizationJobV2;
	body: string;
	start: number;
	end: number;
}

function startMarker(jobId: string): string {
	return `<!-- obsidian-clipper-assets:start:${jobId} -->`;
}

function endMarker(jobId: string): string {
	return `<!-- obsidian-clipper-assets:end:${jobId} -->`;
}

function jobMarkerPrefix(jobId: string): string {
	return `<!-- obsidian-clipper-assets:job:${jobId}:`;
}

export function hasAssetReferences(job: AssetLocalizationJobV2): boolean {
	return job.bodyReferences.length > 0 || job.propertyReferences.length > 0;
}

export function collectAssetUrls(job: AssetLocalizationJobV2): string[] {
	return [...new Set([
		...job.bodyReferences.map(reference => reference.url),
		...job.propertyReferences.map(reference => reference.url),
	])];
}

export function buildAssetLocalizationCallbackUrl(jobId: string, vault: string): string {
	const vaultParameter = vault ? `&vault=${encodeURIComponent(vault)}` : '';
	return `obsidian://web-clipper-localize?job=${encodeURIComponent(jobId)}${vaultParameter}`;
}

export function wrapBodyWithAssetLocalizationJob(body: string, job: AssetLocalizationJobV2): string {
	if (!hasAssetReferences(job)) return body;

	const encodedJob = encodeURIComponent(JSON.stringify(job));
	return `${startMarker(job.id)}\n${body}\n${jobMarkerPrefix(job.id)}${encodedJob} -->\n${endMarker(job.id)}`;
}

export function parseAssetLocalizationEnvelope(noteContent: string, jobId: string): ParsedAssetLocalizationEnvelope {
	const startToken = startMarker(jobId);
	const endToken = endMarker(jobId);
	const manifestPrefix = jobMarkerPrefix(jobId);
	const start = noteContent.indexOf(startToken);

	if (start === -1) {
		throw new Error(`Asset localization job ${jobId} was not found in the target note.`);
	}
	if (noteContent.indexOf(startToken, start + startToken.length) !== -1) {
		throw new Error(`Asset localization job ${jobId} appears more than once in the target note.`);
	}

	const bodyStart = start + startToken.length + 1;
	if (noteContent[start + startToken.length] !== '\n') {
		throw new Error(`Asset localization job ${jobId} has an invalid start marker.`);
	}

	const manifestStartWithSeparator = noteContent.indexOf(`\n${manifestPrefix}`, bodyStart);
	if (manifestStartWithSeparator === -1) {
		throw new Error(`Asset localization job ${jobId} is missing its manifest.`);
	}

	const encodedStart = manifestStartWithSeparator + 1 + manifestPrefix.length;
	const encodedEnd = noteContent.indexOf(' -->', encodedStart);
	if (encodedEnd === -1) {
		throw new Error(`Asset localization job ${jobId} has an invalid manifest marker.`);
	}

	const endStart = noteContent.indexOf(`\n${endToken}`, encodedEnd + 4);
	if (endStart === -1) {
		throw new Error(`Asset localization job ${jobId} is missing its end marker.`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(decodeURIComponent(noteContent.slice(encodedStart, encodedEnd)));
	} catch (error) {
		throw new Error(`Asset localization job ${jobId} contains an invalid manifest: ${String(error)}`);
	}

	if (!isAssetLocalizationJobV2(parsed) || parsed.id !== jobId) {
		throw new Error(`Asset localization job ${jobId} uses an unsupported or mismatched protocol.`);
	}

	return {
		job: parsed,
		body: noteContent.slice(bodyStart, manifestStartWithSeparator),
		start,
		end: endStart + 1 + endToken.length,
	};
}

export function isAssetLocalizationJobV2(value: unknown): value is AssetLocalizationJobV2 {
	if (!value || typeof value !== 'object') return false;
	const job = value as Partial<AssetLocalizationJobV2>;
	if (!(job.version === ASSET_LOCALIZATION_PROTOCOL_VERSION
		&& typeof job.id === 'string'
		&& Array.isArray(job.bodyReferences)
		&& Array.isArray(job.propertyReferences)
		&& Array.isArray(job.transfers)
		&& Array.isArray(job.transferFailures)
		&& job.bodyReferences.every(reference =>
			reference
			&& (reference.kind === 'markdown-image'
				|| reference.kind === 'markdown-image-reference'
				|| reference.kind === 'html-image')
			&& typeof reference.url === 'string'
			&& typeof reference.alt === 'string'
			&& Number.isInteger(reference.start)
			&& Number.isInteger(reference.end)
			&& typeof reference.raw === 'string'
		)
		&& job.propertyReferences.every(reference =>
			reference
			&& typeof reference.propertyName === 'string'
			&& typeof reference.url === 'string'
			&& (reference.listIndex === undefined
				|| (Number.isInteger(reference.listIndex) && reference.listIndex >= 0))
		)
		&& job.transfers.every(transfer =>
			transfer
			&& typeof transfer.url === 'string'
			&& typeof transfer.key === 'string'
			&& /^[A-Za-z0-9-]{1,128}$/.test(transfer.key)
		)
		&& job.transferFailures.every(failure =>
			failure
			&& typeof failure.url === 'string'
			&& typeof failure.message === 'string'
		))) return false;

	const referencedUrls = new Set([
		...job.bodyReferences.map(reference => reference.url),
		...job.propertyReferences.map(reference => reference.url),
	]);
	const transferUrls = new Set(job.transfers.map(transfer => transfer.url));
	const transferKeys = new Set(job.transfers.map(transfer => transfer.key));
	return transferUrls.size === job.transfers.length
		&& transferKeys.size === job.transfers.length
		&& referencedUrls.size === transferUrls.size
		&& [...referencedUrls].every(url => transferUrls.has(url));
}

export function validateBodyReferences(body: string, references: BodyImageReference[]): void {
	for (const reference of references) {
		if (reference.start < 0 || reference.end < reference.start || reference.end > body.length) {
			throw new Error(`Image reference ${reference.url} has an invalid source range.`);
		}
		if (body.slice(reference.start, reference.end) !== reference.raw) {
			throw new Error(`Image reference ${reference.url} changed before it could be localized.`);
		}
	}

	const sorted = [...references].sort((a, b) => a.start - b.start);
	for (let index = 1; index < sorted.length; index++) {
		if (sorted[index].start < sorted[index - 1].end) {
			throw new Error(`Image references overlap near ${sorted[index].url}.`);
		}
	}
}
