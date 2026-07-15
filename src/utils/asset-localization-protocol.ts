export const ASSET_LOCALIZATION_PROTOCOL_VERSION = 1 as const;

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

export interface AssetLocalizationJobV1 {
	version: typeof ASSET_LOCALIZATION_PROTOCOL_VERSION;
	id: string;
	bodyReferences: BodyImageReference[];
	propertyReferences: PropertyImageReference[];
}

export interface ParsedAssetLocalizationEnvelope {
	job: AssetLocalizationJobV1;
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

export function hasAssetReferences(job: AssetLocalizationJobV1): boolean {
	return job.bodyReferences.length > 0 || job.propertyReferences.length > 0;
}

export function buildAssetLocalizationCallbackUrl(jobId: string, vault: string): string {
	const vaultParameter = vault ? `&vault=${encodeURIComponent(vault)}` : '';
	return `obsidian://web-clipper-localize?job=${encodeURIComponent(jobId)}${vaultParameter}`;
}

export function wrapBodyWithAssetLocalizationJob(body: string, job: AssetLocalizationJobV1): string {
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

	if (!isAssetLocalizationJobV1(parsed) || parsed.id !== jobId) {
		throw new Error(`Asset localization job ${jobId} uses an unsupported or mismatched protocol.`);
	}

	return {
		job: parsed,
		body: noteContent.slice(bodyStart, manifestStartWithSeparator),
		start,
		end: endStart + 1 + endToken.length,
	};
}

export function isAssetLocalizationJobV1(value: unknown): value is AssetLocalizationJobV1 {
	if (!value || typeof value !== 'object') return false;
	const job = value as Partial<AssetLocalizationJobV1>;
	return job.version === ASSET_LOCALIZATION_PROTOCOL_VERSION
		&& typeof job.id === 'string'
		&& Array.isArray(job.bodyReferences)
		&& Array.isArray(job.propertyReferences)
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
		);
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
