---
permalink: web-clipper/capture
aliases:
  - Obsidian Web Clipper/Capture web pages
---
Once you install the [[Introduction to Obsidian Web Clipper|Web Clipper]] browser extension, you can access it in several ways, depending on your browser:

1. The Obsidian icon in your browser toolbar.
2. Hotkeys, to activate the extension from your keyboard.
3. Context menu, by right-clicking the web page you are visiting.

To save a page to Obsidian click the **Add to Obsidian** button.

## Capture a page

When you open the extension, Web Clipper extracts data from the current web page following the settings in your [[Obsidian Web Clipper/Templates|template]]. You can create your own templates, and customize the output using [[variables]] and [[filters]].

By default Web Clipper attempts to intelligently extract only the main article content, excluding other elements on the page. However, you can override this behavior in the following ways:

- If a custom template is present it uses your template.
- If a selection is present, it uses the selection. You can use `Ctrl/Cmd+A` to select the entire page.
- If any [[Highlight web pages|highlights]] are present, it uses the highlights.

## Download images

By default, images keep their web-based URLs. This saves space in your vault, but the images will not be accessible offline or if a URL stops working.

To save clipped images as local attachments, install and enable the **Web Clipper Companion** plugin in the target vault. Then enable **Download images to your vault** under **Web Clipper Settings** → **General**. You can override that default for the current clip from the menu next to **Add to Obsidian**.

The companion plugin downloads images referenced by the current clip's note content and properties, stores them using the vault's attachment-folder setting, and replaces successful URLs with Obsidian links. If an image fails to download, its remote URL remains unchanged and Obsidian displays the failure details. Copying to the clipboard and saving a Markdown file do not download images.

Without the companion plugin, you can still download images for any file in Obsidian using the [[Command palette|command]] named **Download attachments for current file**. This command can also be mapped to a hotkey in Obsidian.

## Hotkeys

Web Clipper includes keyboard shortcuts you can use to speed up your workflow. To change key mappings go to **Web Clipper Settings** → **General** and follow the instructions for your browser. Mappings can be changed for all browsers except Safari which does not support editing hotkeys.

| Action                  | macOS         | Windows/Linux  |
| ----------------------- | ------------- | -------------- |
| Open clipper            | `Cmd+Shift+O` | `Ctrl+Shift+O` |
| Quick clip              | `Opt+Shift+O` | `Alt+Shift+O`  |
| Toggle highlighter mode | `Opt+Shift+H` | `Alt+Shift+H`  |

## Interface functionality

The Web Clipper interface is divided into four sections:

1. **Header** where you can switch templates, turn on [[Highlight web pages|highlighting]], and access settings.
2. **Properties** shows the [[Properties|metadata]] extracted from the page that will be saved as [[Properties]] in Obsidian.
3. **Note content** that will be saved to Obsidian.
4. **Footer** allows you select the vault and folder, and add to Obsidian.

Header functionality includes:

- **Template** dropdown to switch between your saved [[Obsidian Web Clipper/Templates|templates]] added in Web Clipper settings.
- **More (...)** button to display page variables you can use in templates.
- **Highlighter** button to turn on [[Highlight web pages|highlighting]].
- **Cog** button to open Web Clipper settings.

Footer functionality includes:

- **Add to Obsidian** button to save data to Obsidian.
- **Vault** dropdown to switch between saved vaults added in Web Clipper settings.
- **Folder** field to define which folder to save to.
- **Interpreter** to run [[Interpret web pages|natural language prompts]] on the page.
