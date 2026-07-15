import browser from './browser-polyfill';
import { AssetTransferFailure, AssetTransferReference } from './asset-localization-protocol';
import { AssetTransferService } from './asset-transfer-routing';

export interface AssetTransferDiscovery {
	ok: boolean;
	services: AssetTransferService[];
	error?: string;
}

interface StageAssetTransferResponse {
	ok: boolean;
	failures: AssetTransferFailure[];
	error?: string;
}

export async function stageAssetTransferJob(
	jobId: string,
	assets: AssetTransferReference[],
	expectedVault: string,
): Promise<AssetTransferFailure[]> {
	const response = await browser.runtime.sendMessage({
		action: 'stageAssetTransferJob',
		jobId,
		assets,
		expectedVault,
	}) as StageAssetTransferResponse | undefined;

	if (!response) {
		throw new Error('The browser background service did not return an asset transfer result.');
	}
	if (!response.ok) {
		throw new Error(response.error || 'The browser could not stage image assets.');
	}
	if (!Array.isArray(response.failures)) throw new Error('The asset transfer result has no failure list.');
	return response.failures;
}

export async function getAssetTransferHealth(): Promise<AssetTransferDiscovery> {
	const response = await browser.runtime.sendMessage({
		action: 'getAssetTransferHealth',
	}) as AssetTransferDiscovery | undefined;
	return response || {
		ok: false,
		services: [],
		error: 'The browser background service did not return a health result.',
	};
}
