---
description: Current attachment routing boundary and assessment of AI SDK v7 file uploads and lifecycle operations
sources:
  - src/main/ai/messages/attachmentRouting.ts
  - src/main/ai/messages/fileProcessor.ts
  - src/main/ai/tools/adapters/aiSdk/builtin/ReadFileTool.ts
  - package.json
---

# Large-File Upload — Current Boundary & v7 Assessment

> Updated 2026-10-01 against Cherry e51a3ad0643 and ai@7.0.123.
> The [June port recipe](https://github.com/CherryHQ/cherry-studio/blob/e51a3ad0643e6d15e76b7720b8739e4fb4f77c6b/docs/references/ai/unified-runtime/large-file-upload-port.md) is historical: its `services/remotefile`,
> `FileServiceManager`, and `resolveFileUIPart` wiring must not be used as the current implementation map.

## Current attachment flow

`src/main/ai/messages/attachmentRouting.ts` decides native file versus extracted text per attachment.
`materializeNativeFilePart` in `fileProcessor.ts` materializes native parts as inline data. Extracted text
is capped; `read_file` pages eligible overflow. See [Chat Attachments](../chat-attachments.md) for modality,
OCR, errors, and fallback behavior.

Provider-native upload would extend the native-file materialization boundary. It must preserve the
current routing contract: the model sees supported native content or extracted text without depending
on a discretionary tool call. A provider upload failure is not permission to silently drop an attachment.

## Upstream capabilities

The v7 baseline introduced `uploadFile` and provider references. **7.0.89** expanded FilesV4 with optional
metadata lookup, streaming download, delete, stream upload, cancellation/headers, and upload size/time/
expiry metadata. This makes the integration a file-lifecycle problem, not just a one-time upload call.

These operations are optional and provider-specific. A V2/V3 compatibility adapter does not establish
support for V4 references. Check the selected provider/model and resolved endpoint before choosing an
uploaded reference over inline materialization.

Sources: [File Uploads](https://ai-sdk.dev/docs/ai-sdk-core/file-uploads),
[7.0.89 release](https://github.com/vercel/ai/releases/tag/ai%407.0.89),
[provider contract history](https://github.com/vercel/ai/blob/ai%407.0.123/packages/provider/CHANGELOG.md).

## Questions an implementation must resolve

| Concern | Required decision / verification |
|---|---|
| Reference ownership | Scope cached references to the actual provider account and endpoint; a model switch may need another upload |
| Expiration and deletion | Decide when to refresh expired references and who owns remote cleanup |
| Streaming and cancellation | Bound memory, propagate cancellation, and verify failure-path stream cleanup |
| Capability fallback | Preserve current native/extracted-text routing where provider upload is unsupported |
| Persistence | Keep durable local file identity distinct from provider-specific remote references |
| Replay and branching | Verify saved messages still resolve after restart, account/endpoint changes, or remote expiry |

This refresh does not choose a cache/store schema, implement remote cleanup, or upgrade the SDK.
Those decisions need a separately scoped change with provider-backed tests. The previous recommendation
to wire an existing `services/remotefile` manager immediately is superseded by the current boundary above.
