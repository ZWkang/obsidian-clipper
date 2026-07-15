import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { extractBodyImageReferences } from '../../src/utils/asset-localization';
import { detectImageMime, replaceBodyReferences } from './localizer';

describe('companion image localizer', () => {
	it('detects supported image signatures', () => {
		const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
		expect(detectImageMime(png.buffer)).toBe('image/png');
		expect(detectImageMime(svg.buffer)).toBe('image/svg+xml');
	});

	it('rewrites only references with downloaded assets', () => {
		const body = [
			'![first](https://example.com/a.png)',
			'![failed](https://example.com/b.png)',
			'![again](https://example.com/a.png)',
		].join('\n');
		const references = extractBodyImageReferences(body);
		const note = new TFile('Clips/Example.md');
		const localImage = new TFile('Attachments/a.png');
		const usedUrls = new Set<string>();
		const app = {
			fileManager: {
				generateMarkdownLink: (_file: TFile, _path: string, _subpath: string, alias: string) => `[[Attachments/a.png|${alias}]]`,
			},
		};

		const result = replaceBodyReferences(
			app as never,
			note,
			body,
			references,
			new Map([['https://example.com/a.png', localImage]]),
			usedUrls,
		);

		expect(result).toContain('![[Attachments/a.png|first]]');
		expect(result).toContain('![failed](https://example.com/b.png)');
		expect(result).toContain('![[Attachments/a.png|again]]');
		expect(usedUrls).toEqual(new Set(['https://example.com/a.png']));
	});
});
