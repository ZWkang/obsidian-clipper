import {
	App,
	Modal,
	Notice,
	TFile,
	normalizePath,
} from 'obsidian';
import {
	BodyImageReference,
	PropertyImageReference,
	collectAssetUrls,
	parseAssetLocalizationEnvelope,
	validateBodyReferences,
} from '../../src/utils/asset-localization-protocol';
import type { StagedAsset } from './transfer-server';

export interface LocalizationFailure {
	url?: string;
	stage: 'protocol' | 'transfer' | 'download' | 'body' | 'property' | 'cleanup';
	message: string;
}

export interface LocalizationResult {
	jobId: string;
	localizedImages: number;
	failures: LocalizationFailure[];
}

interface DownloadedAsset {
	url: string;
	file: TFile;
}

const MIME_EXTENSIONS: Record<string, string> = {
	'image/avif': 'avif',
	'image/bmp': 'bmp',
	'image/gif': 'gif',
	'image/heic': 'heic',
	'image/heif': 'heif',
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/svg+xml': 'svg',
	'image/tiff': 'tiff',
	'image/vnd.microsoft.icon': 'ico',
	'image/webp': 'webp',
	'image/x-icon': 'ico',
};

export async function localizeAssetJob(
	app: App,
	params: Record<string, string>,
	stagedAssets: Map<string, StagedAsset>,
): Promise<LocalizationResult> {
	const jobId = params.job;
	if (!jobId) {
		throw new Error('The Web Clipper callback did not include an asset job ID.');
	}

	const note = resolveTargetNote(app, params);
	const initialContent = await app.vault.read(note);
	const initialEnvelope = parseAssetLocalizationEnvelope(initialContent, jobId);
	validateBodyReferences(initialEnvelope.body, initialEnvelope.job.bodyReferences);

	const failures: LocalizationFailure[] = initialEnvelope.job.transferFailures.map(failure => ({
		url: failure.url,
		stage: 'transfer',
		message: failure.message,
	}));
	const transferFailureUrls = new Set(initialEnvelope.job.transferFailures.map(failure => failure.url));
	const transfersByUrl = new Map(initialEnvelope.job.transfers.map(transfer => [transfer.url, transfer]));
	const uniqueUrls = collectAssetUrls(initialEnvelope.job);
	const downloadResults = await Promise.all(uniqueUrls
		.filter(url => !transferFailureUrls.has(url))
		.map(async url => {
			try {
				const transfer = transfersByUrl.get(url);
				if (!transfer) throw new Error('The image transfer manifest has no key for this URL.');
				const stagedAsset = stagedAssets.get(transfer.key);
				if (!stagedAsset) {
					throw new Error('The browser did not stage this image before Obsidian opened the clip.');
				}
				return { asset: await createAttachmentFromStagedAsset(app, note, url, stagedAsset) };
			} catch (error) {
				return {
					failure: {
						url,
						stage: 'download' as const,
						message: errorMessage(error),
					},
				};
			}
		}));

	const assets = new Map<string, TFile>();
	for (const result of downloadResults) {
		if (result.asset) assets.set(result.asset.url, result.asset.file);
		if (result.failure) failures.push(result.failure);
	}

	const usedUrls = new Set<string>();
	try {
		await app.vault.process(note, currentContent => {
			const envelope = parseAssetLocalizationEnvelope(currentContent, jobId);
			validateBodyReferences(envelope.body, envelope.job.bodyReferences);
			const localizedBody = replaceBodyReferences(app, note, envelope.body, envelope.job.bodyReferences, assets, usedUrls);
			return currentContent.slice(0, envelope.start) + localizedBody + currentContent.slice(envelope.end);
		});
	} catch (error) {
		const cleanupFailures = await cleanupAssets(app, [...assets.values()]);
		const cleanupSuffix = cleanupFailures.length > 0
			? ` Cleanup also failed: ${cleanupFailures.map(failure => failure.message).join('; ')}`
			: '';
		throw new Error(`Unable to rewrite the clipped note: ${errorMessage(error)}${cleanupSuffix}`);
	}

	await replacePropertyReferences(app, note, initialEnvelope.job.propertyReferences, assets, usedUrls, failures);

	const unusedAssets = [...assets.entries()]
		.filter(([url]) => !usedUrls.has(url))
		.map(([, file]) => file);
	failures.push(...await cleanupAssets(app, unusedAssets));

	return {
		jobId,
		localizedImages: usedUrls.size,
		failures,
	};
}

export function showLocalizationResult(app: App, result: LocalizationResult): void {
	if (result.failures.length === 0) {
		new Notice(localizedText(
			`Downloaded ${result.localizedImages} image${result.localizedImages === 1 ? '' : 's'} to the vault.`,
			`已下载 ${result.localizedImages} 张图片到仓库。`,
		));
		return;
	}

	new LocalizationResultModal(app, result.jobId, result.localizedImages, result.failures).open();
}

export function showLocalizationError(app: App, jobId: string, error: unknown): void {
	new LocalizationResultModal(app, jobId, 0, [{
		stage: 'protocol',
		message: errorMessage(error),
	}]).open();
}

export function replaceBodyReferences(
	app: App,
	note: TFile,
	body: string,
	references: BodyImageReference[],
	assets: Map<string, TFile>,
	usedUrls: Set<string>,
): string {
	validateBodyReferences(body, references);
	const replacements = references
		.filter(reference => assets.has(reference.url))
		.map(reference => {
			const file = assets.get(reference.url)!;
			const link = app.fileManager.generateMarkdownLink(file, note.path, '', reference.alt);
			return {
				start: reference.start,
				end: reference.end,
				text: `!${link}`,
				url: reference.url,
			};
		})
		.sort((left, right) => right.start - left.start);

	let output = body;
	for (const replacement of replacements) {
		output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end);
		usedUrls.add(replacement.url);
	}
	return output;
}

async function replacePropertyReferences(
	app: App,
	note: TFile,
	references: PropertyImageReference[],
	assets: Map<string, TFile>,
	usedUrls: Set<string>,
	failures: LocalizationFailure[],
): Promise<void> {
	const downloadableReferences = references.filter(reference => assets.has(reference.url));
	if (downloadableReferences.length === 0) return;

	try {
		await app.fileManager.processFrontMatter(note, frontmatter => {
			for (const reference of downloadableReferences) {
				const file = assets.get(reference.url)!;
				const internalLink = `[[${app.metadataCache.fileToLinktext(file, note.path, false)}]]`;

				if (reference.listIndex !== undefined) {
					const currentValue = frontmatter[reference.propertyName];
					if (!Array.isArray(currentValue) || currentValue[reference.listIndex] !== reference.url) {
						failures.push({
							url: reference.url,
							stage: 'property',
							message: `Property ${reference.propertyName}[${reference.listIndex}] changed before localization.`,
						});
						continue;
					}
					currentValue[reference.listIndex] = internalLink;
					usedUrls.add(reference.url);
					continue;
				}

				if (frontmatter[reference.propertyName] !== reference.url) {
					failures.push({
						url: reference.url,
						stage: 'property',
						message: `Property ${reference.propertyName} changed before localization.`,
					});
					continue;
				}
				frontmatter[reference.propertyName] = internalLink;
				usedUrls.add(reference.url);
			}
		});
	} catch (error) {
		failures.push({
			stage: 'property',
			message: `Unable to update note properties: ${errorMessage(error)}`,
		});
	}
}

function resolveTargetNote(app: App, params: Record<string, string>): TFile {
	if (!params.url) {
		throw new Error('Obsidian did not return the saved note URL to the Web Clipper callback.');
	}

	let filePath: string | null;
	try {
		filePath = new URL(params.url).searchParams.get('file');
	} catch (error) {
		throw new Error(`Obsidian returned an invalid note URL: ${errorMessage(error)}`);
	}
	if (!filePath) {
		throw new Error('The saved note URL does not identify a file.');
	}

	const normalizedPath = normalizePath(filePath.toLowerCase().endsWith('.md') ? filePath : `${filePath}.md`);
	const target = app.vault.getAbstractFileByPath(normalizedPath);
	if (!(target instanceof TFile) || target.extension !== 'md') {
		throw new Error(`The saved note ${normalizedPath} was not found in the active vault.`);
	}
	return target;
}

async function createAttachmentFromStagedAsset(app: App, note: TFile, url: string, staged: StagedAsset): Promise<DownloadedAsset> {
	const detectedType = detectImageMime(staged.data);
	const mimeType = chooseValidatedMimeType(staged.declaredMimeType, detectedType);
	const extension = MIME_EXTENSIONS[mimeType];
	if (!extension) {
		throw new Error(`Unsupported image type ${mimeType}.`);
	}

	const suggestedName = chooseFileName(staged.finalUrl || url, staged.contentDisposition, extension);
	const attachmentPath = await app.fileManager.getAvailablePathForAttachment(suggestedName, note.path);
	const file = await app.vault.createBinary(normalizePath(attachmentPath), staged.data);
	return { url, file };
}

function chooseValidatedMimeType(declaredType: string | undefined, detectedType: string | null): string {
	if (detectedType) {
		if (declaredType?.startsWith('image/') && MIME_EXTENSIONS[declaredType]
			&& MIME_EXTENSIONS[declaredType] !== MIME_EXTENSIONS[detectedType]) {
			throw new Error(`Image content type ${declaredType} does not match detected type ${detectedType}.`);
		}
		return detectedType;
	}
	if (declaredType?.startsWith('image/') && MIME_EXTENSIONS[declaredType]) {
		return declaredType;
	}
	throw new Error(`Response is not a supported image${declaredType ? ` (${declaredType})` : ''}.`);
}

export function detectImageMime(data: ArrayBuffer): string | null {
	const bytes = new Uint8Array(data);
	if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
	if (matches(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
	if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif';
	if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
	if (ascii(bytes, 0, 2) === 'BM') return 'image/bmp';
	if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
		const brand = ascii(bytes, 8, 4);
		if (brand === 'avif' || brand === 'avis') return 'image/avif';
		if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'hevx') return 'image/heic';
		if (brand === 'mif1' || brand === 'msf1') return 'image/heif';
	}
	if (matches(bytes, [0x00, 0x00, 0x01, 0x00])) return 'image/x-icon';
	if (matches(bytes, [0x49, 0x49, 0x2a, 0x00]) || matches(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return 'image/tiff';

	const textPrefix = new TextDecoder().decode(bytes.slice(0, 1024)).replace(/^\uFEFF/, '').trimStart();
	if (/^(?:<\?xml[^>]*>\s*)?<svg\b/i.test(textPrefix)) return 'image/svg+xml';
	return null;
}

function chooseFileName(url: string, contentDisposition: string | undefined, extension: string): string {
	const dispositionName = contentDisposition ? parseContentDispositionFileName(contentDisposition) : null;
	let fileName = dispositionName || urlFileName(url) || `Image.${extension}`;
	fileName = sanitizeAttachmentName(fileName);

	const currentExtension = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
	const sameExtension = currentExtension === extension
		|| (extension === 'jpg' && currentExtension === 'jpeg');
	if (!sameExtension) {
		const baseName = currentExtension ? fileName.slice(0, -(currentExtension.length + 1)) : fileName;
		fileName = `${baseName.replace(/\.+$/, '')}.${extension}`;
	}
	return fileName || `Image.${extension}`;
}

function parseContentDispositionFileName(value: string): string | null {
	const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(value);
	if (utf8Match) {
		try {
			return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ''));
		} catch {
			return utf8Match[1].trim().replace(/^"|"$/g, '');
		}
	}
	const fileNameMatch = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(value);
	return fileNameMatch ? (fileNameMatch[1] || fileNameMatch[2]).trim() : null;
}

function urlFileName(url: string): string | null {
	if (url.startsWith('data:')) return null;
	try {
		const segment = new URL(url).pathname.split('/').filter(Boolean).pop();
		return segment ? decodeURIComponent(segment) : null;
	} catch {
		return null;
	}
}

function sanitizeAttachmentName(value: string): string {
	return value
		.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
		.replace(/\s+/g, ' ')
		.replace(/^\.+|\.+$/g, '')
		.trim();
}

async function cleanupAssets(app: App, files: TFile[]): Promise<LocalizationFailure[]> {
	const failures: LocalizationFailure[] = [];
	for (const file of files) {
		try {
			await app.vault.delete(file);
		} catch (error) {
			failures.push({
				stage: 'cleanup',
				message: `Unable to remove unused attachment ${file.path}: ${errorMessage(error)}`,
			});
		}
	}
	return failures;
}

function matches(bytes: Uint8Array, signature: number[]): boolean {
	return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function localizedText(english: string, chinese: string): string {
	return document.documentElement.lang.toLowerCase().startsWith('zh') ? chinese : english;
}

class LocalizationResultModal extends Modal {
	constructor(
		app: App,
		private readonly jobId: string,
		private readonly localizedImages: number,
		private readonly failures: LocalizationFailure[],
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(localizedText('Web Clipper image download failed', 'Web Clipper 图片下载失败'));
		this.contentEl.createEl('p', {
			text: localizedText(
				`${this.localizedImages} image(s) were localized. ${this.failures.length} operation(s) failed.`,
				`已本地化 ${this.localizedImages} 张图片，${this.failures.length} 个操作失败。`,
			),
		});
		this.contentEl.createEl('p', { text: `Job ID: ${this.jobId}`, cls: 'setting-item-description' });
		const list = this.contentEl.createEl('ul');
		for (const failure of this.failures) {
			list.createEl('li', {
				text: `${failure.stage}: ${failure.url ? `${failure.url} — ` : ''}${failure.message}`,
			});
		}
	}
}
