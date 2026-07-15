import { Plugin } from 'obsidian';
import {
	localizeAssetJob,
	showLocalizationError,
	showLocalizationResult,
} from './localizer';

export default class WebClipperCompanionPlugin extends Plugin {
	onload(): void {
		this.registerObsidianProtocolHandler('web-clipper-localize', async params => {
			const jobId = params.job || 'unknown';
			try {
				const result = await localizeAssetJob(this.app, params);
				console.info('[Web Clipper image localization]', result);
				showLocalizationResult(this.app, result);
			} catch (error) {
				console.error(`[Web Clipper image localization][${jobId}]`, error);
				showLocalizationError(this.app, jobId, error);
			}
		});
	}
}
