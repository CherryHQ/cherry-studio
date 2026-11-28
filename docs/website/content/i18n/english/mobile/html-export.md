---
icon: presentation
---

# HTML to Image and PPT

Convert saved HTML into images or image-based PPT to preserve a card, proposal, or slide's appearance. For individually editable Word, Excel, or PowerPoint content, use [native document creation](file-generation.md).

## Prepare an HTML file

Upload one or ask a tool-capable model in Standard mode:

> Create a standalone HTML presentation with three 16:9 pages for goals, plan, and next steps. Use readable type without online images/fonts. Save project-overview.html and give each page a separate container with class="slide".

An HTML code block is not a saved file. Ask for actual file creation, wait for completion, and open its card or find it in **Files**.

## Share as an image or PPT

1. Open the HTML in **file preview** and inspect its content/completeness.
2. Use Share to open the common preview panel.
3. Convertible HTML offers **Original / Image / PPT** there, rather than the old separate conversion actions in More.
4. Wait and inspect the result. Failure offers retry for the current format, or explicitly select another.
5. Choose **Save** or **Share**, then inspect Photos, the library, or receiving app.

**The file-library list shares originals without conversion tabs.** Open the file's preview first when conversion is needed.

Conversions are initially temporary: image Save writes to Photos and PPT Save to the library. Share alone does not permanently add them to the library. Closing can clean temporary conversions while retaining the original HTML. Opening system sharing does not establish successful saving/sending.

## How do the formats differ?

| Format | Purpose | Result |
| --- | --- | --- |
| PNG | Cards or long-page appearance | Captured according to HTML conversion rules, within image limits |
| PPTX | Page-by-page presentation | Page pictures on 16:9 slides, without individually editable text/charts |

Explicit page markers support page-by-page conversion. Ordinary long pages can be sliced through paragraphs or tables; they are not redesigned automatically. Different proportions retain margins, and a wider capture layout may differ from narrow phone preview.

Chat answer cards have separate height limits. Do not apply [chat sharing](sharing-and-export.md) rules to HTML conversions.

## What happens to watermarks and interactive content?

Shared converted artifacts follow **Settings → General → Share watermark**. Explicit **Save** uses an unwatermarked version. Changing the setting later does not regenerate saved files.

Conversion reads saved HTML rather than transient expansions, clicks, or form values in the current preview. Animation/video does not become playable PPT content. Save the desired state as static page content first.

## Why is conversion unavailable or failing?

* Sharing directly from the library: open the HTML preview first.
* Non-HTML, empty, or partially loaded content: supply a complete, smaller, or split file.
* Unreachable images/fonts: use accessible resources or a standalone file.
* Excessive pages/size: PPT allows at most 64 pages; images also have size limits. Split the material.
* Dynamic layout/background interruption: stay in the foreground and use stable static content.

Failure does not silently change formats. Fix the cause, retry, and inspect page counts, text, and images in the receiving app. The original HTML remains editable.
