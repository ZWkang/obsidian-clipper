import { describe, expect, it } from 'vitest';
import {
	createAssetLocalizationJob,
	extractBodyImageReferences,
	extractPropertyImageReferences,
} from './asset-localization';
import {
	buildAssetLocalizationCallbackUrl,
	parseAssetLocalizationEnvelope,
	validateBodyReferences,
	wrapBodyWithAssetLocalizationJob,
} from './asset-localization-protocol';

describe('asset localization jobs', () => {
	it('extracts Markdown, reference-style, and HTML images', () => {
		const body = [
			'![inline](https://example.com/a.png)',
			'![reference][cover]',
			'<img alt="html" src="https://example.com/c.webp">',
			'',
			'[cover]: https://example.com/b.jpg',
		].join('\n');

		const references = extractBodyImageReferences(body);
		expect(references.map(reference => reference.kind)).toEqual([
			'markdown-image',
			'markdown-image-reference',
			'html-image',
		]);
		expect(references.map(reference => reference.url)).toEqual([
			'https://example.com/a.png',
			'https://example.com/b.jpg',
			'https://example.com/c.webp',
		]);
		expect(() => validateBodyReferences(body, references)).not.toThrow();
	});

	it('extracts scalar and multitext image properties without treating ordinary links as images', () => {
		const references = extractPropertyImageReferences([
			{ name: 'cover', value: 'https://example.com/cover.png' },
			{ name: 'source', value: 'https://example.com/article' },
			{ name: 'gallery', value: '["https://example.com/one.jpg","text","data:image/png;base64,AA=="]' },
		], [
			{ name: 'gallery', type: 'multitext' },
		]);

		expect(references).toEqual([
			{ propertyName: 'cover', url: 'https://example.com/cover.png' },
			{ propertyName: 'gallery', url: 'https://example.com/one.jpg', listIndex: 0 },
			{ propertyName: 'gallery', url: 'data:image/png;base64,AA==', listIndex: 2 },
		]);
	});

	it('extracts extensionless URLs from image-named properties', () => {
		const url = 'https://km.woa.com/asset/00010002260700272d72c1ddc146c601?height=972&width=997';
		expect(extractPropertyImageReferences([
			{ name: 'image', value: url },
			{ name: 'source', value: url },
		], [])).toEqual([
			{ propertyName: 'image', url },
		]);
	});

	it('round-trips the embedded protocol envelope without changing note content', () => {
		const body = 'Before\n![image](https://example.com/image.png)\nAfter';
		const job = createAssetLocalizationJob(body, [], [], 'job-123');
		const wrapped = wrapBodyWithAssetLocalizationJob(body, job);
		const note = `---\ntitle: Test\n---\n${wrapped}`;
		const envelope = parseAssetLocalizationEnvelope(note, job.id);

		expect(envelope.body).toBe(body);
		expect(envelope.job).toEqual(job);
		expect(note.slice(0, envelope.start) + envelope.body + note.slice(envelope.end)).toBe(`---\ntitle: Test\n---\n${body}`);
	});

	it('uses short per-job transfer keys even for data image URLs', () => {
		const dataUrl = `data:image/png;base64,${'A'.repeat(20_000)}`;
		const job = createAssetLocalizationJob(`![inline](${dataUrl})`, [], [], 'job-data');

		expect(job.transfers).toEqual([{ url: dataUrl, key: 'asset-1' }]);
		expect(job.transfers[0].key.length).toBeLessThan(dataUrl.length);
	});

	it('targets the selected vault in the Obsidian callback', () => {
		expect(buildAssetLocalizationCallbackUrl('job 123', 'Work Vault')).toBe(
			'obsidian://web-clipper-localize?job=job%20123&vault=Work%20Vault',
		);
	});

	it('rejects references whose source text changed', () => {
		const body = '![image](https://example.com/image.png)';
		const references = extractBodyImageReferences(body);
		expect(() => validateBodyReferences(body.replace('image.png', 'other.png'), references)).toThrow(/changed/);
	});
});
