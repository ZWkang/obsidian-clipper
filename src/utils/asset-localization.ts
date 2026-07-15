import { fromMarkdown } from 'mdast-util-from-markdown';
import { Property, PropertyType } from '../types/types';
import {
	ASSET_LOCALIZATION_PROTOCOL_VERSION,
	AssetLocalizationJobV2,
	BodyImageReference,
	PropertyImageReference,
} from './asset-localization-protocol';

interface MarkdownNode {
	type: string;
	url?: string;
	identifier?: string;
	alt?: string | null;
	value?: string;
	position?: {
		start: { offset?: number };
		end: { offset?: number };
	};
	children?: MarkdownNode[];
}

const IMAGE_EXTENSIONS = new Set([
	'avif', 'bmp', 'gif', 'heic', 'heif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp'
]);

export function createAssetLocalizationJob(
	body: string,
	properties: Property[],
	propertyTypes: PropertyType[],
	id: string = crypto.randomUUID(),
): AssetLocalizationJobV2 {
	const bodyReferences = extractBodyImageReferences(body);
	const propertyReferences = extractPropertyImageReferences(properties, propertyTypes);
	const urls = [...new Set([
		...bodyReferences.map(reference => reference.url),
		...propertyReferences.map(reference => reference.url),
	])];
	return {
		version: ASSET_LOCALIZATION_PROTOCOL_VERSION,
		id,
		bodyReferences,
		propertyReferences,
		transfers: urls.map((url, index) => ({ url, key: `asset-${index + 1}` })),
		transferFailures: [],
	};
}

export function extractBodyImageReferences(body: string): BodyImageReference[] {
	const tree = fromMarkdown(body) as MarkdownNode;
	const definitions = new Map<string, string>();
	const references: BodyImageReference[] = [];

	walk(tree, node => {
		if (node.type === 'definition' && node.identifier && node.url) {
			definitions.set(node.identifier.toLowerCase(), node.url);
		}
	});

	walk(tree, node => {
		const start = node.position?.start.offset;
		const end = node.position?.end.offset;
		if (start === undefined || end === undefined) return;

		if (node.type === 'image' && node.url && isDownloadableImageSource(node.url)) {
			references.push({
				kind: 'markdown-image',
				url: node.url,
				alt: node.alt || '',
				start,
				end,
				raw: body.slice(start, end),
			});
			return;
		}

		if (node.type === 'imageReference' && node.identifier) {
			const url = definitions.get(node.identifier.toLowerCase());
			if (!url || !isDownloadableImageSource(url)) return;
			references.push({
				kind: 'markdown-image-reference',
				url,
				alt: node.alt || '',
				start,
				end,
				raw: body.slice(start, end),
			});
			return;
		}

		if (node.type === 'html' && node.value) {
			references.push(...extractHtmlImageReferences(node.value, start));
		}
	});

	return references.sort((a, b) => a.start - b.start);
}

export function extractPropertyImageReferences(
	properties: Property[],
	propertyTypes: PropertyType[],
): PropertyImageReference[] {
	const typeMap = new Map(propertyTypes.map(propertyType => [propertyType.name, propertyType.type]));
	const references: PropertyImageReference[] = [];

	for (const property of properties) {
		if (typeof property.value !== 'string') continue;
		const propertyType = typeMap.get(property.name) || property.type || 'text';

		if (propertyType === 'multitext') {
			const values = parseMultitextProperty(property.value);
			values.forEach((value, listIndex) => {
				if (looksLikePropertyImageUrl(value, property.name)) {
					references.push({ propertyName: property.name, url: value, listIndex });
				}
			});
			continue;
		}

		const value = property.value.trim();
		if (looksLikePropertyImageUrl(value, property.name)) {
			references.push({ propertyName: property.name, url: value });
		}
	}

	return references;
}

function walk(node: MarkdownNode, visitor: (node: MarkdownNode) => void): void {
	visitor(node);
	for (const child of node.children || []) {
		walk(child, visitor);
	}
}

function extractHtmlImageReferences(html: string, baseOffset: number): BodyImageReference[] {
	const references: BodyImageReference[] = [];
	const imagePattern = /<img\b[^>]*>/gi;
	let match: RegExpExecArray | null;

	while ((match = imagePattern.exec(html)) !== null) {
		const tag = match[0];
		const src = getHtmlAttribute(tag, 'src');
		if (!src || !isDownloadableImageSource(src)) continue;
		const start = baseOffset + match.index;
		references.push({
			kind: 'html-image',
			url: src,
			alt: getHtmlAttribute(tag, 'alt') || '',
			start,
			end: start + tag.length,
			raw: tag,
		});
	}

	return references;
}

function getHtmlAttribute(tag: string, name: string): string | null {
	const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag);
	if (quoted) return decodeHtmlEntities(quoted[2]);
	const unquoted = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i').exec(tag);
	return unquoted ? decodeHtmlEntities(unquoted[1]) : null;
}

function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>');
}

function isDownloadableImageSource(value: string): boolean {
	return /^(https?:\/\/|data:image\/)/i.test(value.trim());
}

function looksLikePropertyImageUrl(value: string, propertyName: string): boolean {
	if (/^data:image\//i.test(value)) return true;
	if (!/^https?:\/\//i.test(value)) return false;
	if (/^(?:image|cover|thumbnail|banner|favicon|icon|poster)$/i.test(propertyName.trim())) return true;
	try {
		const pathname = new URL(value).pathname;
		const extension = pathname.split('.').pop()?.toLowerCase() || '';
		return IMAGE_EXTENSIONS.has(extension);
	} catch {
		return false;
	}
}

function parseMultitextProperty(value: string): string[] {
	const trimmed = value.trim();
	if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				return parsed.filter((item): item is string => typeof item === 'string');
			}
		} catch {
			// Use the same comma-separated interpretation as frontmatter generation.
		}
	}
	return value.split(/,(?![^\[]*\]\])/).map(item => item.trim()).filter(Boolean);
}
