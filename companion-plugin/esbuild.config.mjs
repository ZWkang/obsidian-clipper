import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

await mkdir(outputDirectory, { recursive: true });
await copyFile(resolve(root, 'manifest.json'), resolve(outputDirectory, 'manifest.json'));
await copyFile(resolve(root, 'versions.json'), resolve(outputDirectory, 'versions.json'));

const options = {
	entryPoints: [resolve(root, 'src/main.ts')],
	bundle: true,
	external: ['obsidian', 'electron', '@codemirror/state', '@codemirror/view'],
	format: 'cjs',
	target: 'es2020',
	platform: 'browser',
	sourcemap: watch ? 'inline' : false,
	outfile: resolve(outputDirectory, 'main.js'),
	logLevel: 'info',
};

if (watch) {
	const context = await esbuild.context(options);
	await context.watch();
} else {
	await esbuild.build(options);
}
