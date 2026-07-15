# Web Clipper Companion

This companion plugin lets Obsidian Web Clipper download images directly into the target vault. The browser extension cannot write to a vault by itself, so the plugin receives a narrow `obsidian://web-clipper-localize` callback after the note is created.

## Install for development

1. Run `npm run build:companion` in the Web Clipper repository.
2. Copy the contents of `companion-plugin/dist` into `<vault>/.obsidian/plugins/obsidian-web-clipper-companion`.
3. Reload Obsidian and enable **Web Clipper Companion** under Community plugins.
4. Enable **Download images to your vault** in Web Clipper settings, or enable it for one clip from the save menu.

The plugin uses the vault's configured attachment location and link format. It must be enabled in every target vault. Obsidian 1.13 and later may ask for confirmation the first time the custom URI action runs.

If an image fails, successful images remain local, the failed URL remains unchanged, and Obsidian displays the URL and error. The plugin never reports a failed job as successful.
