import { describe, expect, it } from 'vitest';
import { AssetTransferServer } from './transfer-server';

describe('asset transfer server', () => {
	it('reports its live port and stages binary image data', async () => {
		const lastFocusedAt = Date.now();
		const server = new AssetTransferServer(() => 'Work Vault', 0, () => lastFocusedAt);
		await server.start();
		try {
			const status = server.getStatus();
			expect(status.state).toBe('running');
			expect(status.port).toBeGreaterThan(0);

			const baseUrl = `http://${status.host}:${status.port}`;
			const preflight = await fetch(`${baseUrl}/health`, {
				method: 'OPTIONS',
				headers: {
					Origin: 'chrome-extension://test-extension',
					'Access-Control-Request-Method': 'GET',
					'Access-Control-Request-Headers': 'X-Web-Clipper-Probe',
				},
			});
			expect(preflight.status).toBe(204);
			expect(preflight.headers.get('access-control-allow-methods')).toContain('GET');

			// Chromium extension background GET requests can omit Origin even when
			// the extension has host permissions.
			const health = await fetch(`${baseUrl}/health`, {
				headers: { 'X-Web-Clipper-Probe': '1' },
			}).then(response => response.json());
			expect(health).toMatchObject({
				ok: true,
				port: status.port,
				vault: 'Work Vault',
				lastFocusedAt,
			});

			const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
			const upload = await fetch(`${baseUrl}/v1/jobs/job-123/assets/asset-1`, {
				method: 'POST',
				headers: {
					Origin: 'chrome-extension://test-extension',
					'Content-Type': 'image/png',
				},
				body: png,
			});
			expect(upload.status).toBe(201);

			const assets = server.takeJob('job-123');
			expect(assets.get('asset-1')?.declaredMimeType).toBe('image/png');
			expect(new Uint8Array(assets.get('asset-1')!.data)).toEqual(png);
			expect(server.takeJob('job-123').size).toBe(0);
		} finally {
			await server.stop();
		}
	});

	it('moves to the next candidate port when another vault already owns a port', async () => {
		const first = new AssetTransferServer(() => 'Personal', 0);
		await first.start();
		const occupiedPort = first.getStatus().port;
		const second = new AssetTransferServer(() => 'Work', undefined, () => 0, [occupiedPort, 0]);
		try {
			await second.start();
			expect(second.getStatus().state).toBe('running');
			expect(second.getStatus().port).not.toBe(occupiedPort);
		} finally {
			await second.stop();
			await first.stop();
		}
	});

	it('rejects uploads from ordinary web origins', async () => {
		const server = new AssetTransferServer(() => 'Work Vault', 0);
		await server.start();
		try {
			const status = server.getStatus();
			const response = await fetch(
				`http://${status.host}:${status.port}/v1/jobs/job-123/assets/asset-1`,
				{
					method: 'POST',
					headers: { Origin: 'https://example.com', 'Content-Type': 'image/png' },
					body: Uint8Array.from([0x89, 0x50]),
				},
			);
			expect(response.status).toBe(403);
		} finally {
			await server.stop();
		}
	});

	it('rejects originless health requests without the extension probe marker', async () => {
		const server = new AssetTransferServer(() => 'Work Vault', 0);
		await server.start();
		try {
			const status = server.getStatus();
			const response = await fetch(`http://${status.host}:${status.port}/health`);
			expect(response.status).toBe(403);
		} finally {
			await server.stop();
		}
	});
});
