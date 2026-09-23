---
description: Image model configuration, standard API routing, versioned paintings, durable task recovery, and generated-file delivery
sources:
  - packages/provider-registry/src/creators/imageCanvases.ts
  - src/shared/ai/imageGenerationConfig.ts
  - src/shared/ai/generateImageTool.ts
  - src/main/ai/AiService.ts
  - src/main/ai/provider/custom/tasks/imageGenerationJobHandler.ts
  - src/main/data/services/PaintingService.ts
  - src/renderer/pages/paintings
  - tests/e2e/smoke/image-workflow.test.ts
---

# Image Workflow

The Paintings page and image-generation tools share model capabilities, request
validation, protocol adapters, and FileManager storage. They retain separate
business histories: an image created in a conversation does not automatically
create a painting project.

## Model settings and request parameters

Image parameter templates provide initial defaults and available values. The
model's saved configuration belongs to its provider/model identity and survives
renaming and catalog refreshes. Generate and Edit have separate configuration;
Edit can inherit Generate. Valid edits are saved in sequence, invalid drafts stay
local, and failed writes expose retry without discarding the draft.

Resolution is selected before aspect ratio. Pixel-based protocols use the model's
canvas table, explicit overrides, or configured size rules. Native resolution
protocols retain their native fields. Expected dimensions are shown only when
known; decoded output dimensions are the evidence for the actual result.

Explicit request parameters override saved defaults. An Auto aspect ratio leaves
fixed pixel dimensions unspecified. Output-format dependencies are validated:
transparent output requires PNG/WebP, and JPEG/WebP compression does not apply
to PNG.

## Protocol routing

Provider endpoints determine the connection. Existing custom connection URLs
are preserved when a bundled provider gains image endpoints; explicit image
URLs take precedence. The application does not identify gateway brands or
rewrite their URLs to guess a different protocol.

| Protocol | Generate | Edit |
| --- | --- | --- |
| OpenAI Images | JSON to images/generations | Multipart image upload to images/edits |
| Gemini native | generateContent with imageConfig | Same operation with reference-image parts |
| xAI Images | Native image generation fields | JSON reference-image editing |
| Ark Seedream | JSON to images/generations | Same operation with image references |

Seedream's parameter template supports an explicit OpenAI Images or Ark protocol
selection. Existing configurations default to Ark; compatible OpenAI connections
must select OpenAI Images to use multipart editing. Resetting parameter defaults
does not reset the selected protocol. Ark failures preserve the service's error
message instead of displaying only an HTTP status.

Catalog data that needs new runtime semantics must raise its compatibility
floor. The catalog publisher preserves previously published data while the
source application version is below that floor, and applies the semantic floor
to older schema streams as well. A schema down-conversion cannot implement
request behavior missing from an older application.

## Projects, versions, and recovery

A painting project owns independently persisted generation/edit steps. Each
step records its parameters, parent, source image, status, and output references.
Editing an older version creates another step; it does not overwrite the source
image. The selected step and selected output can be restored after reopening.

Different requests may run concurrently. Their cancellation and completion are
scoped to their own steps. Project cancellation resolves all persisted steps,
not only controllers held by the current renderer, and finishes before moving
the project to the Recycle Bin. Restoring a project restores its versions.

Custom submit/poll transports use durable jobs with a painting step as their
result destination. Before contacting a provider, the job records that submission
started. Startup recovery follows these rules:

- Resume polling or downloading only when a remote task ID or resumable URLs are known.
- Start queued painting jobs that are known not to have been submitted.
- Interrupt requests whose submission outcome is unknown instead of submitting
  another potentially billable generation.
- Abandon prior-process tool jobs without a durable result destination.

AI initialization owns this reconciliation; the generic JobManager stays unaware
of painting entities. PaintingService emits changes after database updates and
the history hooks subscribe to them so recovered results reach open views.

## Files and conversation results

Generated images use existing FileEntry IDs. The generated-images envelope
carries file references rather than embedding complete image bytes for internal
display. Parsers accept the direct result, supported MCP/Pi/Claude wrappers, and
legacy arrays or image blocks. Ordinary chat and agent-session messages register
the referenced files transactionally.

Pi's painting adapter publishes nested tool results independently of a code-mode
script's return value. A script that ignores the image result or fails afterward
does not hide an already completed image. The generic code executor does not
recognize painting-specific tool identities.

The transcript retains per-image loading/failure/retry states and a shared
preview sequence for multiple results. Markdown export resolves stable file IDs
and copies images into a relative assets directory, or embeds them when selected.
Conversation output does not become painting history implicitly.

## Verification and limits

Focused tests cover parameter conversion, persistence, provider request boundaries,
unknown-outcome recovery, project cancellation, file references, export, and UI
state. The isolated Electron case verifies generated-file persistence across an
application restart. The model-settings script exercises configuration and HTTP
requests against a local fixture:

- [Image workflow E2E](../../../tests/e2e/smoke/image-workflow.test.ts)
- [Model settings desktop fixture](../../../tests/e2e/smoke/utils/check-image-settings.cjs)
- [E2E setup and commands](../../../tests/e2e/README.md)

Mocked responses establish request shape and local application behavior, not real
provider authentication, billing, output dimensions, or long-term availability.
Interrupted requests are not automatically retried. Existing manual file-cleanup
policy remains in place where a durable consumer may not yet have registered a
reference.
