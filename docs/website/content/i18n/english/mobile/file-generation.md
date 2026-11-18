---
icon: file-text
---

# Create and Edit Files

Agents can save text and create or edit genuine Word, Excel, and PowerPoint files. Use **Standard** mode with a tool-capable text model, then specify the format, content, and destination.

## Save an answer as a file

Request a saved result with a filename:

> Turn the travel advice into a Markdown checklist named weekend-packing-list.md and provide a file I can open.

> Create budget.xlsx from the attached shopping list, with category totals and a separate detail worksheet.

Wait for the tool to finish and open the returned file card, or find it under **Files**. Streaming text or a code block is not proof that a file was saved.

## Which format should I choose?

| Desired result | Format | Notes |
| --- | --- | --- |
| Plain text, notes, or checklists | TXT, Markdown | Easy to copy and edit |
| Simple table data | CSV | No workbook sheets, styles, or charts |
| Paragraphs, headings, tables, and images | DOCX | A genuine Word document editable in compatible software |
| Worksheets, formulas, and table data | XLSX | A genuine Excel workbook; verify calculated results |
| Editable presentations | PPTX | Document tools create supported text, images, and slide content |
| Webpages, cards, or appearance-focused slides | HTML | Preview or [convert to images or image-based PPT](html-export.md) |

The old restriction to text-only file creation no longer applies. The text writer still has a **1 MiB** UTF-8 limit per file; Office tools use their own formats and limits. Renaming text to `.docx`, `.xlsx`, or `.pptx` still does not produce a valid Office document.

Native PPTX creation differs from HTML conversion: native files can contain editable objects, while converted PPTX pages are pictures. Choose according to whether individual objects need later editing.

## Save through workspace paths

Associate a workspace through **＋ → Folders**, then request a path such as notes/meeting-notes.md. New outputs go there, or to the file-library root if no workspace is associated. You can also ask the agent to create a folder first.

Several conversations can share a folder. Changing the association does not move earlier files; see [file workspaces](file-library.md).

## Read and edit an existing file

1. Attach it through **＋ → Files**, or use workspace material.
2. Ask the agent to inspect its structure, then specify changes and what must remain.
3. Open the resulting file and inspect it before sharing.

For example:

> Inspect this Word document's headings and tables. Change the delivery date in section two to next Wednesday and preserve everything else.

> In the attached workbook, change only B5 on the Budget worksheet. Preserve all other sheets and formulas.

You can select paragraphs, cells, or slides in Word, Excel, and PowerPoint previews and return that selection to chat. A selection identifies context; it does not perform an edit by itself.

PDF text extraction, supported recognition, and previews do not imply arbitrary editing of the original PDF layout. Check complex layouts, macros, external links, charts, and unsupported structures separately. Follow tool errors and narrow the change when necessary.

### Does editing overwrite the original?

* Editing an older file retains the source version and returns a new file or logical-file revision; historical messages keep their earlier references.
* Drafts created within one task can be refined without creating a separate library item for every change.
* Editing an imported copy does not synchronize the original elsewhere on your device or cloud drive.

Check the returned file and actual library result rather than inferring overwrites from a filename.

### Why can't it find the text to replace?

Replacement needs a matching source. Changed content, repeated sentences, spaces, or punctuation can prevent it. Ask the agent to reread and locate the target. For Office files, identify paragraphs, worksheets/cells, or slides structurally.

## Does reading part of a file mean it read everything?

No. Large files, pagination, and parsers have separate limits. Ask for coverage and unread portions. Truncated source content or unrecognized pages require additional or smaller material.

Office tools can inspect structure and validate file packages, but validity does not establish content correctness. A missing Excel formula cache differs from a formula error; open the workbook in software that recalculates formulas instead of treating missing cached results as zero.

Tools access authorized conversation attachments, outputs, and workspace material, not the entire phone.

## Find, preview, and share files

Open an output in **Files** to preview supported documents. Word previews fit the screen and support zooming; selected content can be handed back to chat. Open oversized or unsupported files in another app.

Copy may contain only displayed content; **sharing the original** transfers the complete file. The common panel offers **Save** and **Share**; see [Sharing and export](sharing-and-export.md) for destinations and temporary-file behavior.

Save important results outside the app and confirm the receiving software can open them. File reads and text/Office creation and editing generally proceed directly; moves, deletion, and external changes have their own approval rules. See [tools](using-tools.md).
