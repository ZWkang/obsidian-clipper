export class TFile {
	path: string;
	extension: string;
	basename: string;

	constructor(path: string) {
		this.path = path;
		const name = path.split('/').pop() || path;
		this.extension = name.includes('.') ? name.split('.').pop()! : '';
		this.basename = this.extension ? name.slice(0, -(this.extension.length + 1)) : name;
	}
}

export class Modal {
	contentEl = document.createElement('div') as HTMLDivElement & {
		createEl: (tag: string, options?: { text?: string; cls?: string }) => HTMLElement;
	};

	constructor(_app: unknown) {
		this.contentEl.createEl = (tag, options) => {
			const element = document.createElement(tag);
			if (options?.text) element.textContent = options.text;
			if (options?.cls) element.className = options.cls;
			this.contentEl.appendChild(element);
			return element;
		};
	}

	setTitle(_title: string): void {}
	open(): void {}
}

export class Notice {
	constructor(_message: string) {}
}

export class Plugin {}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export async function requestUrl(): Promise<never> {
	throw new Error('requestUrl is not implemented in tests');
}
