---
icon: file-text
---

# Create and Edit Files

An agent can save text as a file for you to preview, revise, and share. This suits checklists, meeting notes, table data, and simple web pages.

## Save an answer as a file

Select a text model that supports tool calls and explicitly request a **saved file** with a filename:

> Turn the travel advice above into a Markdown checklist. Save it as weekend-packing-list.md and provide a file I can open.

Markdown is a text format for headings, lists, and tables. For plain text, ask for a `.txt` file.

Text shown during generation is content being prepared, not an already saved file. Wait for completion, then open the resulting file card. You can also find it under **Files** in the sidebar.

If the answer only contains a code block, follow up with: “Please save this content as an actual file, not only display it in the response.”

## Which format should I choose?

| Desired result | Format | Example |
| --- | --- | --- |
| Plain text | TXT | “Save it as call-notes.txt.” |
| An article with headings, lists, and tables | Markdown | “Save it as meeting-notes.md.” |
| Data for a spreadsheet app | CSV | “Use item, quantity, and notes columns; save as shopping-list.csv.” |
| A designed page or presentation | HTML | “Create a standalone HTML file named project-overview.html.” |

The built-in file writing tool saves text, up to 1 MB per file. **Naming a file `.docx`, `.xlsx`, or `.pptx` does not turn it into a genuine Office document.** CSV opens in spreadsheet apps but does not contain workbook sheets, styling, or charts.

For PPT, create an HTML presentation and use [HTML to Image and PPT](html-export.md). A connected plugin may offer other document-creation features; its actual capabilities determine what is available.

## Save through workspace paths

Associate a folder from the conversation header, then ask “Save the summary as notes/meeting-notes.md.” New outputs go to that workspace, or to the library root when none is associated. Several conversations can use the same folder; see [File library and shared workspaces](file-library.md).

## Read and edit an existing file

1. In the conversation, choose **＋ → File** and select or upload a file.
2. Specify exactly what to change, the replacement, and what should stay unchanged.
3. Open the revised file and check the result.

For example:

> In the attached shopping-list.csv, change the quantity for Umbrella from 1 to 2. Keep all other rows unchanged.

> In the meeting-notes.md you just created, replace “Deliver next Monday” with “Deliver next Wednesday.” Keep everything else.

Text files can be edited directly. Supported PDF and Office documents can provide extracted content for the model to read, but the built-in editor cannot directly modify their original layout and file structure. Ask it to extract and organize the content into a new Markdown file instead. See [Chat and Files](chat-and-files.md) for attachment formats and reading limits.

### Does editing overwrite the original?

* Editing an uploaded file or an earlier response's file retains the old content and creates a new version. The library shows the logical file's current version; earlier messages keep their original references. This does not mean each edit appears as a separate file named `v2`.
* Within one response, the agent may refine its current draft repeatedly and finish with one file, instead of producing a new version for every change.

This is not continuous synchronization. Editing an imported copy in Cherry Studio does not update the original elsewhere on your phone or in cloud storage.

### Why can't it find the text to replace?

Editing matches the original text. Changed wording, repeated sentences, and differences in spaces or punctuation can prevent a clear match. Ask the agent to reread the relevant passage and identify a longer sentence or surrounding context. Request replacement of every occurrence only when that is what you intend.

## Does reading part of a file mean it read everything?

No. Large files may need multiple reads, and document extraction has its own limits. For a full review, ask the agent to continue through unread sections and state any gaps. If extraction already omitted part of the source, further reads cannot recover it; split the document and provide it again.

Reading tools use accessible attachments, outputs, and associated workspace material, not every file on your phone. In another conversation, attach the file again or associate the same [folder workspace](file-library.md).

## Find, preview, and share files

Open **Files** from the sidebar to browse by type and switch between list and grid views. Tap a file to preview it. Formats without an internal preview can open in another system app.

The preview's top-right **More** menu offers sharing and opening with other apps. Text files also offer copying. When a long file is only partially displayed, copying includes only that visible portion; sharing uses the complete original file.

Files are stored on this device. Save important material to the system Files app or other storage through sharing, and confirm you can open it before cleaning local files or uninstalling Cherry Studio. Exporting chat messages uses a separate workflow: [Sharing and Export](sharing-and-export.md).

Built-in text file reading, creation, and editing usually run directly, including in **Ask when needed** mode. See [Tool Approval](using-tools.md).
