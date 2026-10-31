---
icon: note-sticky
---
# Notes

Notes is the built-in Markdown editor in Cherry Studio, designed to help you organize ideas, save interim outputs, and further process content using AI and knowledge base capabilities beyond AI conversations.

### Open Notes

Click **Notes** in the top tab bar, or click the **Notes** app icon in the **Launcher**.

<figure><img src="../../../../assets/d6f7037adac8dbb53bc478e3.webp" alt=""><figcaption><p>Notes interface: The left side contains the directory tree and note list, while the right side is the Markdown editor</p></figcaption></figure>

### Create Your First Note

1. Click the first **New Note** icon in the top-left corner
2. Enter content in the editor on the right, which supports Markdown syntax and a rich text toolbar
3. Right-click the note in the list to rename it

### Import Existing Markdown Files

* **Drag and drop** `.md` files or directories containing `.md` files into the notes area to import them as new notes or folders
* Alternatively, click the second **New Folder** icon in the top-left corner to create a directory first, then drag files into it

### Editor Features

The toolbar at the top of the notes editor provides common rich text capabilities:

* **Formatting**: Bold (<kbd>B</kbd>), Italic (<kbd>I</kbd>), Underline (<kbd>U</kbd>), Strikethrough
* **Structure**: Inline code / H1–H3 headings / Unordered list / Ordered list / Code block / Quote / Task list / Formula
* **Embedding**: Tables, Hyperlinks

The status bar at the bottom displays the current **character count**. The **A✓** icon in the bottom-left corner toggles spell check. The dropdown in the bottom-right corner switches between **Live Preview**, **Source Mode**, or **Reading Mode**.

### Directory Management

The top of the left sidebar contains: **New Note** / **New Folder** / **Sort** / **Favorites** / **Search**.

* **Sort**: 6 options—Filename `A→Z` / `Z→A`, Updated time (newest to oldest / oldest to newest), Created time (newest to oldest / oldest to newest)
* **Favorites**: The star button switches to the "Favorites" view
* **Search**: Click the magnifying glass icon and type in the search box. **Search matches both titles and content**. Entries matching content will display a "Content" or "Name+Content" tag next to the title to indicate the source

### Right-Click Menu (AI Integration + Export)

**Right-click** any note in the left directory tree to open the action menu—this is the entry point for AI integration and multi-format export:

<figure><img src="../../../../assets/04138079f771916dd9892ab7.webp" alt=""><figcaption><p>Menu displayed when right-clicking a single note</p></figcaption></figure>

* **Generate Note Name** ✨: Let AI automatically generate a title based on the content (available for files only)
* **Rename** / **Open from external** (Show in Finder / Explorer)
* **Favorite note** / **Unfavorite**
* **Export notes to knowledge base**: Send to a specified [Knowledge Base](../../knowledge-base/knowledge-base.md)
* **Export ›** submenu: Markdown / Word (.docx) / Notion / Yuque / Obsidian / Joplin / Siyuan, as well as "Copy as Image / Export as Image"—the visibility of each item can be toggled individually in **Settings** → **Data Settings** → **Export Menu Settings**
* **Delete**

> The right-click menu for folders is more concise, containing only: New Note / New Folder / Rename / Open from external / Delete.

### Top-Right [⋯] Menu (View and Export Shortcuts)

The [⋯] button in the top-right corner of the note title is the **current note's** view/export shortcut entry. Do not confuse it with the right-click menu:

<figure><img src="../../../../assets/d3f34c20b533b7559ece483c.webp" alt=""><figcaption><p>Top-right [⋯] menu</p></figcaption></figure>

* **Copy Content**: Copy as plain text
* **Export to Word**: Quickly generate `.docx` (use the "Export ›" option in the right-click menu for more formats)
* **Export to PDF**: Export the current note as a PDF file
* **Print**: Invoke the system print dialog for the current note
* **Content Compression**: Limit the maximum characters per line
* **Show Table of Contents**: Display the heading tree of the current note on the right
* **Line Break Mode**: Toggle the editor's line break mode
* **Font settings**: Default font / Serif font, and three font sizes (Small / Medium / Large)
* **More Settings**: Open the notes settings panel (Data / Editor / Display settings groups)

### Working Directory and Backup

Note content is stored as local files. The **Working Directory** can be viewed and modified in **Data Settings** within the notes settings panel (accessed via top-right [⋯] → **More Settings**).

* By default, it is located in the Cherry Studio application data directory
* First click **Select** to choose a custom path, then click **Apply** to switch (changes do not automatically migrate existing files; manual copying is required). Click **Reset to Default** to restore the default directory
* It is recommended to combine backups with [WebDAV](../../pre-basic/data-settings/webdav.md) / [S3-compatible storage](../../pre-basic/data-settings/s3-compatible.md)

### Editor and Display Settings

Open the notes settings panel via top-right [⋯] → **More Settings**. In addition to **Data Settings**, there are two other groups:

**Editor Settings**

* **Default View**: Whether new notes default to **Edit Mode** or **Reading Mode**
* **Default Edit View**: Whether Edit Mode defaults to **Live Preview** or **Source Mode**

**Display Settings**

* **Font**: Default / Serif font
* **Font Size**: Between 10–30px
* **Content Compression**: Limit characters per line to prevent long lines from spanning the entire screen
* **Show Table of Contents Outline**: Display the heading tree of the current note on the right for in-document navigation

> Font and size can be adjusted in this Display Settings panel or quickly switched via top-right [⋯] → **Font settings**.

### Tips and Tricks

* Notes support task list `- [ ]` syntax, useful for daily to-dos
* Drag `.md` files (or directories containing `.md`) into the directory tree for batch import
* If the notes directory appears empty after restoring configuration across devices, manually copy files to the path indicated in the prompt

{% hint style="info" %}
To have AI answer questions **directly** based on note content, the most convenient method is to **export the target note to a Knowledge Base**, then enable that knowledge base in the conversation.
{% endhint %}

***

### Get Help and Submit Feedback

If you have any questions, bugs, or feature improvement suggestions during configuration or usage, please refer to the official channels provided in [Feedback and Suggestions](../../question-contact/suggestions.md).
