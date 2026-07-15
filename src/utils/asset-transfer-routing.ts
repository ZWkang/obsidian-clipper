export interface AssetTransferService {
	ok: true;
	service: 'obsidian-web-clipper-companion';
	version: string;
	host: string;
	port: number;
	vault: string;
	lastFocusedAt: number;
}

export type AssetTransferServiceSelection =
	| { service: AssetTransferService; error?: never }
	| { service?: never; error: string };

export function selectAssetTransferService(
	services: AssetTransferService[],
	expectedVault: string,
): AssetTransferServiceSelection {
	if (services.length === 0) {
		return { error: 'No running Web Clipper Companion service was discovered.' };
	}

	if (expectedVault) {
		const matches = services.filter(service => service.vault === expectedVault);
		if (matches.length === 0) {
			return {
				error: `No companion service is running for vault ${expectedVault}. Running services: ${formatServices(services)}.`,
			};
		}
		return chooseMostRecentlyFocused(matches, `More than one companion service is running for vault ${expectedVault}`);
	}

	if (services.length === 1) return { service: services[0] };
	return chooseMostRecentlyFocused(
		services,
		'Multiple companion services are running and no vault was selected',
	);
}

function chooseMostRecentlyFocused(
	services: AssetTransferService[],
	errorPrefix: string,
): AssetTransferServiceSelection {
	const sorted = [...services].sort((left, right) => right.lastFocusedAt - left.lastFocusedAt);
	const newest = sorted[0];
	const next = sorted[1];
	if (newest.lastFocusedAt > 0 && (!next || newest.lastFocusedAt > next.lastFocusedAt)) {
		return { service: newest };
	}
	return {
		error: `${errorPrefix}: ${formatServices(services)}. Focus the target Obsidian window or select its vault explicitly.`,
	};
}

function formatServices(services: AssetTransferService[]): string {
	return services.map(service => `${service.vault} (${service.host}:${service.port})`).join(', ');
}
