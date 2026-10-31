---
description: FilesV4 attachment lifecycle migration and separate SkillsV4 adoption decisions, with scoped references and acceptance gates
sources:
  - src/main/ai/messages/attachmentRouting.ts
  - src/main/ai/messages/fileProcessor.ts
  - src/main/ai/tools/adapters/aiSdk/builtin/ReadFileTool.ts
  - src/main/services/file
  - src/main/ai/runtime/aiSdk/retry/createRetryableWrap.ts
  - src/main/ai/runtime/pi/PiRuntimeConnection.ts
  - src/main/ai/runtime/claudeCode
  - package.json
---

# FilesV4 and SkillsV4 — Upload Migration Boundaries

> Refreshed 2026-10-04 against Cherry `e3052500309` and the [pinned SDK release/main baseline](./aisdk-v7-research.md#reproducible-baseline).
> FilesV4 contracts are unchanged from the earlier `ai@7.0.123` assessment. Status: **planned**;
> provider/model support, persistence design and runtime acceptance have not been validated.
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

## F — Implementation slices

F1's existing attachment behavior is part of the SDK upgrade gate. F2–F4 add provider-native upload
and lifecycle handling after that baseline; they do not depend on Tool Search, Code Mode or Harness.
Agent adapters consuming these files must pass their attachment cases before their own cutover.

1. **F1 — Inventory and preserve inputs.** Follow composer/file ingestion → FileManager identity →
   `attachmentRouting.ts` → `fileProcessor.ts` → SDK message conversion → resolved provider request.
   Cover image/PDF/office/text/audio/video, OCR, `read_file`, external URL parts, multi-model requests,
   resend and saved history. Preserve the [current per-file routing/error contract](../chat-attachments.md),
   including the distinction between first-party and external parts. Do not conflate a local import,
   a provider upload, and copying a file into an Agent workspace.
2. **F2 — Add upload at the materialization boundary.** For each provider/model/endpoint, verify both
   the Files API and consumption of its reference by the intended operation. Record supported MIME,
   size, readiness/poll requirements, upload purpose/options, streaming, metadata, download and delete.
   Select inline/upload/extraction from proven support and explicit limits; uploading a PDF does not
   prove the selected model can read it. Preserve configured fetch/proxy/headers and cancellation.
3. **F3 — Own references and their lifecycle.** Choose a store/lifecycle owner using the existing
   [FileManager contract](../../file/file-manager-architecture.md) and data-system rules. Associate
   references with local content version, actual provider account/credential scope, endpoint, purpose,
   remote identity, readiness and expiry. A provider-name-only SDK reference is not a sufficient cache
   key. Define concurrent upload reuse, invalidation, cleanup after failed admission, and remote deletion
   when no active consumer needs the object. Never persist credentials or replace durable local file
   identity with an expiring remote ID. Document absent metadata/delete support and the resulting limit.
4. **F4 — Rebind and replay.** Resolve references for each actual invocation, including key failover,
   provider/model fallback and multi-model fan-out. Revalidate after expiry, content/account/endpoint
   changes and restart; renew only where bytes and capability remain available. Preserve saved-message
   readability, request attachment allow-lists and Agent workspace access rules. Inspect the actual
   final request to prove it contains a usable reference or supported content, not just a local ID.
5. **F5 — Cut over and retire by provider route.** Keep inline/extraction paths for unsupported routes.
   Remove only upload/materialization code whose consumers migrated; local FileManager, extraction,
   OCR and `read_file` remain distinct owners. Rollback must still render stored messages and account
   for outstanding remote files. New persistence schemas, if needed, require appended migrations and
   populated-database validation.

### Decisions required before F2–F4 implementation

| Concern | Required decision / verification |
|---|---|
| Reference ownership | Scope cached references to the actual provider account and endpoint; a model switch may need another upload |
| Expiration and deletion | Decide when to refresh expired references and who owns remote cleanup |
| Streaming and cancellation | Bound memory, propagate cancellation, and verify failure-path stream cleanup |
| Capability fallback | Preserve current native/extracted-text routing where provider upload is unsupported |
| Persistence | Keep durable local file identity distinct from provider-specific remote references |
| Replay and branching | Verify saved messages still resolve after restart, account/endpoint changes, or remote expiry |
| Failure policy | Specify when an upload failure can safely use inline/extracted content and when to surface an error; never silently omit content |
| Shared consumers | Define in-flight upload reuse and deletion protection across concurrent turns, image/video jobs and accounts |

These decisions are **unresolved**, not implicitly deferred out of the migration scope. Each needs a
recorded choice and supporting provider tests before its slice can move to implementing. The previous
recommendation to wire an existing `services/remotefile` manager is superseded by the boundary above.

## File acceptance

Use the real SDK/provider package against a controlled HTTP endpoint, then a real provider that supports
the operation. Inspect uploaded bytes, outbound message content, remote requests, local references and
reopened history. A mock returning a file ID does not establish compatibility.

| ID | Scenario / failure | Observable acceptance |
|---|---|---|
| F-01 | Native/extracted attachment matrix, OCR failure, missing file, external parts and long text | Existing routing/error contract preserved; supported content actually reaches the model; overflow remains request-scoped |
| F-02 | Small inline vs large upload, ready vs processing file, unsupported operation/MIME/size | Correct route with measured memory bound; provider consumes the uploaded reference only when ready and supported |
| F-03 | Reuse across turns; simultaneous consumers; content/key/account/endpoint switch | Valid reuse is scoped correctly; changed scope cannot send another account's file ID; cancellation of one caller does not corrupt another |
| F-04 | Abort, validation error, network failure and upload accepted before local failure | Streams/resources close; outcome and any orphan cleanup are tracked; retry opens fresh input and does not silently lose the attachment |
| F-05 | Remote expiry/deletion, cold restart, resend/fork, multi-model/key fallback | Bytes/reference are re-resolved for the actual target; saved history remains readable; unavailable content has an explicit outcome |
| F-06 | Delete/cleanup while another turn or media job references the file | Active inputs remain usable; completed cleanup targets only the owned remote scope and local lifetime; unsupported remote deletion is reported accurately |

F-01 is mandatory SDK-09 regression coverage. F-02–06 gate the new upload lifecycle. Record the
provider/model matrix, chosen lifecycle owner, request evidence and rollback before enabling a route.

## S — Provider skill uploads

**S1 disposition: decision pending.** `uploadSkill` / `SkillsV4` was already exported in `ai@7.0.123`;
its omission from the earlier inventory did not mean it was absent upstream. It uploads a skill file set
through `provider.skills()` and returns a provider reference with optional version/metadata. Anthropic
and OpenAI have implementations, but upload success alone does not prove the intended inference route
can use the skill.

Keep three surfaces distinct: FilesV4 attachment references; Cherry-managed local skill directories
(`additionalSkillPaths` in `PiRuntimeConnection` and Claude's enabled-skill whitelist); and remote provider
skills. Harness adapter skill configuration does not establish provider upload support or replace the
local installer. Record adopt, retain-local or defer with a reason, tracking record and revisit trigger.
No blanket upload of installed skills is implied.

If adopted, define the file manifest/path and size limits, provider/account/endpoint scope, content
version, returned reference/version and actual inference binding (for example Anthropic container skills
or OpenAI shell-environment skills). Decide how references survive local edits, credential changes,
restart and failed admission. **SkillsV4 only standardizes upload**: it does not inherit FilesV4
metadata/download/delete/streaming APIs or public cancellation/header options. Record unsupported
cleanup/cancellation and uncertain accepted uploads explicitly rather than promising those operations.

| ID | Scenario / failure | Observable adoption gate |
|---|---|---|
| S-01 | Valid skill file set, rejected path/size, unsupported provider or inference route | Intended files reach the provider; returned reference/version is consumed by the selected operation; unsupported use is explicit |
| S-02 | Local skill edited, account/endpoint changed, concurrent sessions, cold restart | Content and remote version bind to the intended scope; another account's reference is never reused; local skills remain independently usable |
| S-03 | Upload error, caller stops, remote acceptance before local failure | No false inference success or blind duplicate upload; cancellation and cleanup limits are visible; late results have a defined owner |

Sources: [public upload API](https://github.com/vercel/ai/blob/ai%407.0.123/packages/ai/src/upload-skill/upload-skill.ts),
[SkillsV4 contract](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/packages/provider/src/skills/v4/skills-v4.ts),
[upload options](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/packages/provider/src/skills/v4/skills-v4-upload-skill-call-options.ts),
[Anthropic implementation](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/packages/anthropic/src/skills/anthropic-skills.ts),
and [OpenAI implementation](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/packages/openai/src/skills/openai-skills.ts).
