---
icon: image
---

# Image generation

Standalone drawing uses a board to retain the relationships between generations and edits. Start from text, a reference image, or a template, then choose a result to develop further. Configure an image-generation model first; understanding images does not necessarily mean a model can generate them.

## Three ways to create

| Workflow | Start here | Results |
| --- | --- | --- |
| Standalone drawing | Open **Drawings**, start a creation, select a photo, or use a template | Board results, accessible again from the drawing list |
| Image model in chat | Choose an image-generation model for a Standard-mode agent | Image attachments in that conversation |
| Drawing tool used by a text agent | Select a drawing model in **Settings → Default model**; the retired agent capability switch is not required | Tool activity and images in chat |

The tool workflow requests confirmation for every image call, including under automatic approval. Standalone and direct image-model requests are submitted when you press Send. Board instructions below apply to standalone drawing.

## Start from a description

1. Open a new creation from Drawings.
2. Choose a model and generation parameters through the composer's **＋** menu.
3. Describe the subject, purpose, style, and composition; check references and send.
4. Wait for the result and inspect its details. On failure, open error details before retrying.

Example:

> A landscape cover for reading notes: an open book and cup of tea on a wooden table, soft morning light, warm white and pale wood, space on the left, no text.

The first generation creates a board. Aspect ratio, size, count, and other parameters depend on the model. Larger or more numerous outputs can take longer and cost more. Expand the composer for a longer editing field.

## Start with a template

Browse template categories, open one, and inspect its example, prompt variables, and required photos. Replace photos or edit variables, choose the model/parameters, then generate.

The template panel can start the first generation and open a new board; it does not merely copy a prompt into chat. The preview remains an example rather than this request's output. Check the actual reference photos and instructions before submitting.

## Switch between focus and overview

* **Focus** displays the current image. Pinch or double-tap to zoom; swipe horizontally between images from the same generation.
* Opening a board from the gallery enters its **overview**; opening a single result, file, or notification can focus that image. The header board action switches layers.
* Tap a canvas node to select it, then tap the selected node to focus it. Tap empty space to clear selection; pan/zoom to inspect relationships.
* The lineage strip shows sources, the current image, and later results. Tap to navigate or hold a thumbnail for a temporary comparison.
* Tap a prompt caption in the overview, or open generation information from the menu, to read the full description. Rename the board from its overview.

## Continue with a reference image

The focused image becomes a reference for the next generation. Inspect references before submitting. Removing it means this request will not continue from that image. The overview continues from its selected node. Clear selection on empty canvas to start a new root; overview input is not always reference-free.

> Keep this image's composition and subject, change the background to evening, and preserve the other details where possible.

Reference and editing support depend on the model. A text-to-image-only model does not gain editing capabilities from the board; image-required models need a reference. Not every image on the board is sent with the next request.

### Explain changes with positional notes

Long-press the focused image to add a note, select it, and type the change. Switch to the whole-image selection for general instructions. Sending supplies the reference and these instructions to the model.

Notes are positional text guidance, **not precise masks**. They cannot guarantee that changes remain inside a marked area. Describe what must stay unchanged and inspect the result.

Supported models offer ratio shortcuts. Choosing one prepares settings or instructions without sending; review the input and submit explicitly.

## Failures, cancellation, and repeated requests

You can browse the board while generation runs. Check task status before taking the next step. Failed results offer retry, error details, and applicable [diagnosis](diagnostics.md); earlier successful results remain usable. Stopping a running generation removes its placeholder.

Cancellation does not prove the provider stopped processing or guarantee a refund. Unsupported models, incompatible references, credits, rate limits, and network failures need different remedies.

## Save and share

Use the focused image's menu for saving, sharing, or generation information. Share a complete generation's image group, completed board outputs from overview, or batch-selected gallery results. Input references/graph connections are not exported, and share selection does not change canvas focus.

Supported GIF output retains animation in preview, saving, and original-file sharing. New GPT Image 2.6 requests explicitly default to GIF while respecting supported format choices. Chat cards do not replace animated originals.

Handle photo-saving permissions when the OS requests them. Deleting a painting version differs from deleting its library file; see [File library and shared workspaces](file-library.md).

Control future shared artifacts through **Settings → General → Share watermark**; local saves are unwatermarked. Chat images can be exported with selected exchanges; see [Sharing and export](sharing-and-export.md).
