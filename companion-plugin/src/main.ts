import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import {
	localizeAssetJob,
	showLocalizationError,
	showLocalizationResult,
} from './localizer';
import { AssetTransferServer } from './transfer-server';

export default class WebClipperCompanionPlugin extends Plugin {
	private lastFocusedAt = 0;
	private transferServer = new AssetTransferServer(
		() => this.app.vault.getName(),
		undefined,
		() => this.lastFocusedAt,
	);

	async onload(): Promise<void> {
		if (document.hasFocus()) this.lastFocusedAt = Date.now();
		this.registerDomEvent(window, 'focus', () => {
			this.lastFocusedAt = Date.now();
		});
		this.addSettingTab(new CompanionSettingTab(this.app, this, this.transferServer));
		this.registerObsidianProtocolHandler('web-clipper-localize', async params => {
			const jobId = params.job || 'unknown';
			try {
				const stagedAssets = this.transferServer.takeJob(jobId);
				const result = await localizeAssetJob(this.app, params, stagedAssets);
				console.info('[Web Clipper image localization]', result);
				showLocalizationResult(this.app, result);
			} catch (error) {
				console.error(`[Web Clipper image localization][${jobId}]`, error);
				showLocalizationError(this.app, jobId, error);
			}
		});

		try {
			await this.transferServer.start();
			const status = this.transferServer.getStatus();
			console.info(`[Web Clipper Companion] Asset transfer service listening on ${status.host}:${status.port}.`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error('[Web Clipper Companion] Asset transfer service failed to start', error);
			new Notice(`Web Clipper Companion transfer service failed: ${message}`, 0);
		}
	}

	onunload(): void {
		void this.transferServer.stop().catch(error => {
			console.error('[Web Clipper Companion] Failed to stop transfer service', error);
		});
	}
}

class CompanionSettingTab extends PluginSettingTab {
	private refreshTimer: number | null = null;

	constructor(
		app: App,
		plugin: Plugin,
		private readonly transferServer: AssetTransferServer,
	) {
		super(app, plugin);
	}

	display(): void {
		this.clearRefreshTimer();
		this.containerEl.empty();
		this.containerEl.createEl('h2', { text: 'Web Clipper Companion' });

		const serviceSetting = new Setting(this.containerEl)
			.setName('Local image transfer service');
		const renderStatus = () => {
			const status = this.transferServer.getStatus();
			if (status.state === 'running') {
				serviceSetting.setDesc(`Running · http://${status.host}:${status.port} · Vault: ${this.app.vault.getName()}`);
			} else if (status.state === 'error') {
				serviceSetting.setDesc(`Stopped · ${status.error || 'Unknown server error'} · ${status.host}:${status.port}`);
			} else {
				serviceSetting.setDesc(`${status.state} · ${status.host}:${status.port}`);
			}
		};
		renderStatus();
		this.refreshTimer = window.setInterval(renderStatus, 2000);

		new Setting(this.containerEl)
			.setName('Transfer lifetime')
			.setDesc('Uploaded image bytes stay in memory for at most 10 minutes and are removed immediately after the matching clip is processed.');
	}

	hide(): void {
		this.clearRefreshTimer();
	}

	private clearRefreshTimer(): void {
		if (this.refreshTimer !== null) {
			window.clearInterval(this.refreshTimer);
			this.refreshTimer = null;
		}
	}
}
