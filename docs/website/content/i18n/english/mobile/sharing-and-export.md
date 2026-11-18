---
icon: share-2
---

# Sharing and export

Select content at its source, choose a format in the common preview, then choose **Save** or **Share**. Save keeps results in Photos or the file library; Share delivers temporary artifacts to the system sharing sheet.

## Share selected messages

1. Use an answer's share action or a message menu. **Selection starts in the original conversation**, retaining the composer draft instead of opening a separate excerpt-selection page.
2. Select questions and answers. Selecting a question also selects its currently displayed completed answer; deselecting the question does not deselect that answer.
3. Select all is available, with a limit of **128 exportable messages**. Alternative answers cannot be switched during selection; exit selection first.
4. Choose **Share** to open Image, HTML, or Markdown preview.
5. Inspect the range and result, then use **Save** or **Share** in the preview.

Only selected content is exported, in the current conversation path's chronological order. Unfinished, missing, or changed messages may reject preparation; return to the source and reselect. Long answers can appear collapsed during selection, while HTML/Markdown read the complete selected final text.

## Include a translation

Expand the desired translation and choose its language before entering selection. Only completed, expanded translations matching the source are included. Folded, incomplete, or stale translations are omitted; sharing does not translate again. See [translation](translation.md).

## Choose a format

| Format | Good for | Content |
| --- | --- | --- |
| PNG image | Short content for direct reading in messaging apps | One height-bounded card; long text, code, or tables are truncated with an ellipsis |
| HTML | Complete selected final text, code, and richer layout | Requires a browser or compatible reader |
| Markdown | Complete text, code, and tables for editing | Rendering depends on the reader |

**Chat images no longer default to pages or offer a single-long-image/paged switch.** The whole card is limited to 3600 logical points, up to 1080 × 10800 output pixels including its footer. For complete long text or code, use HTML/Markdown or reduce the selection.

Files, image groups, and HTML conversions may have multiple preview items; those pages do not restore the old chat-card pagination behavior. Check citations against the original source.

## Why does the selection screen describe different formats?

Current selection stays in the conversation, and every nonempty valid selection can open Image, HTML, or Markdown preview.

## Include thinking and tool activity

**These are not exported.** Exports contain selected user content, final answers, supported static images, attachment information, citations, and matching expanded translations. There is no Include thinking option. Thinking, intermediate prose, tool names or execution records, duration, usage, and diagnostic payloads are excluded.

Use [diagnosis and feedback](diagnostics.md) for error evidence; chat sharing is not a complete execution log.

## Can Markdown images work offline?

Supported local images can be embedded, making the file larger; some readers do not display embedded content. GIF, WebP, and other unsupported embeddings may become unavailable-image notes. Preserve animation through [original image sharing](image-generation.md), not a chat card.

Remote pictures may still depend on their links, and attachment descriptions do not package the originals. Share original files separately and check them at the destination.

## Image export failed

Failure **keeps the selected format and offers Retry; it does not silently fall back to HTML or Markdown**. Fix the cause, retry, or explicitly choose another format. Switching formats cancels obsolete preparation; follow the final selection and preview.

Keep long conversions in the foreground. Closing the panel returns to the source; change a message range by selecting again in the conversation. Opening or dismissing the system sheet does not establish successful saving or sending.

## Remove the watermark

**Settings → General → Share watermark** controls future shared artifacts and is on by default. Existing saved or shared content does not change.

The preview's **Save** action creates unwatermarked results: chat images go to Photos and HTML/Markdown to the file library. Share follows the global watermark setting. Save and Share have different destinations and behavior.

## File library and original files

Select one or several files in **Files** to preview them in their original order in the common panel. File-library sharing sends original files and does not offer HTML conversion tabs.

* **Share** does not automatically add temporary exports to the library. Choose **Save** to retain them.
* Image groups can be browsed and saved to Photos. Shared bitmaps can carry the configured watermark; local saves remain unwatermarked.
* Copying large text may use only displayed content; share the original for a complete file.
* If one member fails preparation, fix it or reselect. Opening the panel does not establish complete batch delivery.

## Turn HTML into images or slides

Open the HTML in **file preview**, then share and choose **Original / Image / PPT** where conversion is offered. This differs from original-file sharing in the library list. See [HTML to Image and PPT](html-export.md).

Converted PPTX slides contain pictures. For editable text and tables, ask the agent to [create native Office files](file-generation.md).

## Share a generated file or presentation

Open the result and choose Save or Share. Files kept only in the app library remain local app data; save important results elsewhere and confirm they open before uninstalling. Individual exports do not replace a [full backup](backup-and-restore.md). See [file library](file-library.md) for folders, trash, and revisions.
