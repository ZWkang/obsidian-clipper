# Web Clipper Companion

This desktop companion plugin lets Obsidian Web Clipper save authenticated images directly into the target vault. Each open vault claims its own available port on `127.0.0.1` in the discovery range `27123–27223`, receives image bytes from the browser extension, and processes a narrow `obsidian://web-clipper-localize` callback after the note is created.

## Install for development

1. Run `npm run build:companion` in the Web Clipper repository.
2. Copy the contents of `companion-plugin/dist` into `<vault>/.obsidian/plugins/obsidian-web-clipper-companion`.
3. Reload Obsidian and enable **Web Clipper Companion** under Community plugins.
4. Enable **Download images to your vault** in Web Clipper settings, or enable it for one clip from the save menu.

The plugin uses the vault's configured attachment location and link format. It must be enabled in every target vault. Its settings page shows whether the local transfer service is running and the bound port. Staged bytes expire after 10 minutes and are removed immediately when the matching clip is processed. Obsidian 1.13 and later may ask for confirmation the first time the custom URI action runs.

If an image fails, successful images remain local, the failed URL remains unchanged, and Obsidian displays the URL and error. The plugin never reports a failed job as successful.
