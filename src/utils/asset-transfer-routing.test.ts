import { describe, expect, it } from 'vitest';
import { AssetTransferService, selectAssetTransferService } from './asset-transfer-routing';

function service(vault: string, port: number, lastFocusedAt: number): AssetTransferService {
	return {
		ok: true,
		service: 'obsidian-web-clipper-companion',
		version: '1.1.0',
		host: '127.0.0.1',
		port,
		vault,
		lastFocusedAt,
	};
}

describe('asset transfer service routing', () => {
	it('routes an explicitly selected vault to its own dynamic port', () => {
		const result = selectAssetTransferService([
			service('Personal', 27123, 200),
			service('Work', 27124, 100),
		], 'Work');

		expect(result.service?.port).toBe(27124);
	});

	it('uses the most recently focused vault when no vault is selected', () => {
		const result = selectAssetTransferService([
			service('Personal', 27123, 100),
			service('Work', 27124, 200),
		], '');

		expect(result.service?.vault).toBe('Work');
	});

	it('reports ambiguous multi-vault routing instead of guessing', () => {
		const result = selectAssetTransferService([
			service('Personal', 27123, 0),
			service('Work', 27124, 0),
		], '');

		expect(result.error).toContain('Multiple companion services');
	});
});
