---
description: Image capability, request preparation, execution and delivery contracts for the staged generation refactor
sources:
  - packages/provider-registry/src/schemas/model.ts
  - packages/provider-registry/src/schemas/imageParamCatalog.ts
  - packages/provider-registry/src/providers
  - src/main/ai/AiService.ts
  - src/main/ai/provider/custom/imageTransport.ts
  - src/main/ai/provider/custom/tasks/imageGenerationJobHandler.ts
  - src/main/data/services/PaintingService.ts
---

# Image Generation Contract

Status: accepted target; implementation is staged. Catalog inspection and external
documentation retrieval: 2026-09-09. This replaces the transport-only refactoring
scope and the mode-based assumptions in [the parameter pipeline](image-generation-parameters.md).
It does not claim that every catalog entry is currently executable.

## Ownership

```text
provider-model declarations → effective capability → form / tool schema
                                      ↓
business request → Main preparation → SDK or custom protocol → staged files
                          ↓                  ↓                    ↓
                   fixed execution     shared task runtime   business delivery
                       identity         inside existing Job   or tool retention
```

| Owner | Owns | Must not own |
| --- | --- | --- |
| Registry | Canonical parameter support, input constraints, genuine operation differences, provider protocol declarations | Credentials, request state, polling |
| Capability resolver | One effective view used by the form, tool and Main | Provider-name heuristics, HTTP |
| Main preparation | Provider instance, API model ID, validated input and canonical parameters, executable target | Vendor field spelling, result references |
| SDK adapter / protocol | Terminal encoding, vendor response validation | Business mode inference, independent polling |
| Task runtime | Submit, awaited task-ID persistence, query, retry, timeout, cancellation | Queue policy, painting records |
| Job | Existing scheduling, input references, task state and progress bridge | Re-resolving a different protocol |
| Output staging | Download/create, tracking new files, failed-delivery compensation | Painting semantics |
| Painting orchestration | Atomically associate successful outputs before returning | HTTP and remote task state |

## Capability vocabulary

The effective view exposes `supports` and `inputs`, independently of protocol.
`supports` derives its keys and values from `CanonicalParamKey` and `SupportSpec`;
it is not a new parameter vocabulary. Input facts are `images.min`, `images.max`,
`prompt`, `mask` and `mediaTypes`. Unknown facts use an explicit `unknown` state,
not a permissive default, an invented limit or a claim of unsupported behavior.

The ordinary request operation is `generate`, with zero or more images as allowed
by its input contract. An image-only model has a positive minimum image count.
`remix` and `upscale` remain separate operations where their semantics are actually
declared. Neither is automatically advertised on every model. Legacy `edit` means
image input; legacy `merge` is a multiple-image alias only where its declared
parameter and protocol contracts agree with the image-input path.

The image-capability v2 design, published as registry v4, uses base `supports` and `inputs`, optional
`withImages` differences, optional `operations` differences, and a separate
`protocol` binding. A difference contains only changed facts. Input presence may
select a protocol endpoint, but an endpoint difference does not create a UI mode.
There is no general conditional-expression language.

Override rules, limited to `imageGeneration`:

- Parameter keys merge; a supplied `SupportSpec` replaces the whole prior spec.
  `null` explicitly removes an inherited key. Arrays replace rather than append.
- Explicit input fields override, then the complete constraints are validated.
- A supplied protocol binding replaces the complete binding. Partial endpoints
  cannot inherit a response parser from a different protocol.
- Operation/input differences apply to that effective base. Only `generate` with
  images applies `withImages`, followed by `operations.generate`; `remix` and
  `upscale` use their own differences without `withImages`. The exact inheritance
  and `null` rules are documented in the [registry architecture](../../../packages/provider-registry/docs/architecture.md#override-rules).

The catalog schema and runtime resolver use this contract directly; there is no
legacy whole-block reader or second hand-maintained capability table. The schema
validates combined input/operation differences in runtime order. Generation and
the frozen v4 compatibility validator additionally check creator/provider
combinations through the same resolver.

### Registry publication and application compatibility

Registry v2/v3 are already occupied by upstream releases. This contract therefore
uses an independent **v4** stream with **minimum application version 2.1.5**.
The frozen v1/v2/v3 validators are preserved unchanged, and older streams retain
their published compatibility floors. Do not overwrite them with the new schema.
The publisher does not backfill v4 catalogs into v1/v2/v3, whose tolerant
validators can silently discard the new image shape instead of rejecting it.

The current application version remains 2.1.4; this PR does not bump it. A v4
manifest may be published beforehand, but its minimum application version gates
adoption until 2.1.5 and the manifest's compatible release range. The updater
selects a version-specific cache and publication path,
so legacy v2/v3 caches are not migrated or read as v4. Historical C12 verification
does not constitute acceptance of the merged implementation or the new baseline.

## Aspect ratio boundary

`aspectRatio` is a business value: two positive finite numbers separated by `:`,
such as `16:9`, `10:16` or `1.5:1`. The explicit `auto` value requests server
selection and is accepted only when the effective model capability declares it.
An unconfigured model cannot implicitly opt into `auto`. Missing input remains
missing; request preparation does not inject a ratio or a catalog default.

Ratio support is a nonempty enum at every declaration layer: base, image-input
difference, operation difference and provider override. A supplied default must
belong to that enum. Preserve the model's option order and exact values, without
reducing `10:16` to `5:8` or unioning different models' supported sets.

`size` describes dimensions, not a second source for `aspectRatio`. Main, the
form and tool schemas share the canonical value domain. SDK adapters read the
native ratio once, not aliases in provider-options bags. Invalid values fail
validation rather than disappearing as if the caller requested `auto`.

Protocol spelling belongs only at the final request boundary:

- Gemini receives the canonical ratio in `imageConfig.aspectRatio`; Imagen
  receives it through the SDK's native ratio parameter. Explicit `auto` and
  absence omit the ratio. Unrelated image settings remain intact.
- Ideogram V1/V2 encode `16:9` as `ASPECT_16_9`; V3 encodes it as `16x9`.
  Those wire values are not accepted in business requests or registry options.
- The UI displays the canonical ratio verbatim, pixel dimensions as dimensions,
  and `auto` using the existing localized label.

Wire references, retrieved 2026-10-08: [Google ImageConfig](https://ai.google.dev/api/generate-content#ImageConfig),
[Ideogram V1/V2](https://developer.ideogram.ai/v1/api-reference/legacy-endpoints/generate),
[Ideogram V3](https://developer.ideogram.ai/v1/api-reference/generate-images/generate-v3),
and [AiHubMix Ideogram](https://docs.aihubmix.com/cn/api/IdeogramAI).

This is stricter than older catalogs that contained `ASPECT_*` or `1x1` aliases:
the new schema rejects those entries. Successful old-client validation of a new
catalog does not prove new-client compatibility with an old cached catalog.
The v4 frozen-baseline and 2.1.5 release gate above applies; this change does not
add an alias fallback or cache migration. Ratio regression cases are authored but have not been
run under the current no-test instruction; prior C12 results do not cover them.

User-facing change for 2.1.5 (#20140): use the model's offered ratio choices, or
pass a supported canonical value such as `aspectRatio: '16:9'` in custom image
requests. Omit it to leave the ratio unspecified; use `auto` only when offered.
Existing custom requests using `ASPECT_*`, `16x9`, or ratios in `size` must be
updated. A selected ratio must reach generation without being changed or dropped.

## Catalog and protocol acceptance matrix

This is a family-level migration inventory, not a second routing table. The exact
model IDs, parameter sets and limits come from the linked source declarations.
In the pre-v2 migration baseline, declarations containing both `generate` and
`edit` had identical `supports`; the DMXAPI `merge` declarations likewise shared
their image-input parameter set. These are historical aliases, not current
operation values. A later difference must be represented, not unioned.

| Source / current family | Input and operation distinction | Execution acceptance |
| --- | --- | --- |
| [OpenAI creator](../../../packages/provider-registry/src/creators/openai.ts), compatible connections | GPT generation with optional images; mask only where the actual SDK/protocol supports it | Keep SDK generation/edit delegation and its wire model ID; never route GPT edit to Ideogram |
| [AiHubMix](../../../packages/provider-registry/src/providers/aihubmix.ts) Qwen / iRAG | Qwen-image text input; Qwen-image-edit and ERNIE edit require images | Explicit prediction binding; preserve existing Qianfan paths, not a generic non-generate branch |
| AiHubMix Doubao | Reference images do not create another operation | Prediction binding; preserve canonical boolean/seed values |
| AiHubMix BFL FLUX | Optional reference input, no artificial edit mode | Existing task protocol; initial 2 s, fixed 2 s, 5 min total |
| [Ideogram creator](../../../packages/provider-registry/src/creators/ideogram.ts) / AiHubMix | Remix has image weight; upscale has resemblance/detail and optional prompt | V1/V2 native endpoints and V3 prediction must have explicit, separate bindings; catalog absence does not manufacture a served model |
| [TokenHub](../../../packages/provider-registry/src/providers/tokenhub.ts) Hunyuan v3 | 0–3 reference images under ordinary generation | Native synchronous Hunyuan binding, not OpenAI-compatible |
| TokenHub Seedream pro / lite | 0–10 / 0–14 reference images; lite group output is a parameter | Native synchronous Seedream binding |
| TokenHub Vidu Q2 | 0–7 reference images under ordinary generation | Native submit/query binding |
| [PPIO](../../../packages/provider-registry/src/providers/ppio.ts) | Text-only, image-only and optional-reference models; prompt optional only when explicitly declared | Preserve each declared endpoint and sync/task behavior |
| [DashScope](../../../packages/provider-registry/src/providers/dashscope.ts) | Qwen/Wan image input; translation allows no prompt | Preserve declared protocol family; real task cancellation is best effort |
| [ModelScope](../../../packages/provider-registry/src/providers/modelscope.ts) | Generic inference capability must be explicit; do not infer image support from an adapter name | Preserve task protocol; public documentation could not be text-retrieved on this date, so unresolved constraints remain unknown |
| [DMXAPI](../../../packages/provider-registry/src/providers/dmxapi.ts) | Current merge aliases use multiple references, not another parameter vocabulary | Keep native-family predicate and SDK families distinct; retain 401 token / 403 balance errors |
| [SiliconFlow](../../../packages/provider-registry/src/providers/silicon.ts) | Model-specific reference image support | Custom HTTP adapter, preserving current input and output encoding |
| [Ollama](../../../packages/provider-registry/src/providers/ollama.ts) | Current experimental image models | Existing behavior is characterization, not an externally verified contract; preserve injected proxy fetch |
| [OVMS](../../../packages/provider-registry/src/providers/ovms.ts) | Current text-to-image path | Keep `/images/generations`; endpoint upgrade is outside this refactor |
| Google / Vertex / remaining SDK-backed models | Use actual SDK family capabilities, not generic image-recognition metadata | Preserve SDK delegation, batching, warnings and usage ownership |
| Minimax, OpenRouter, Zhipu and other registry-only declarations | Parameter declarations alone prove neither a working endpoint nor complete image constraints | Resolve against the existing executor; return unconfigured when no executable image protocol exists, never silently choose the first mode |
| Unknown / custom model | No unrelated creator limits | Generic SDK protocol only if the connection explicitly supports it; native protocol without a binding is unconfigured |

TokenHub's currently served image rows are Hunyuan v3, Seedream pro/lite and Vidu
Q2. `hy-image-lite` in the creator catalog, an old database row or a user-entered
model does not establish a TokenHub endpoint. Do not invent one.

External evidence (retrieved 2026-09-09):

- [AiHubMix legacy image API](https://docs.aihubmix.com/cn/api/Image-Gen) documents
  compatible generation/edit and prediction protocols. New unified endpoints in
  that document are not adopted by this refactor.
- [AiHubMix Ideogram](https://docs.aihubmix.com/cn/api/IdeogramAI) documents separate
  remix/upscale requests, JPEG/PNG/WebP input and optional upscale prompt.
- TokenHub [Hunyuan](https://cloud.tencent.com/document/product/1823/135745),
  [Seedream](https://cloud.tencent.com/document/product/1823/136609) and
  [Vidu](https://cloud.tencent.com/document/product/1823/135746) document reference
  images independently of text generation, with the limits above.
- [PPIO task query](https://ppio.com/docs/models/reference-get-async-task-result)
  and [DashScope task management](https://help.aliyun.com/en/model-studio/manage-asynchronous-tasks)
  are the task-state oracles. DashScope only cancels `PENDING` tasks.
- [SiliconFlow image API](https://api-docs.siliconflow.cn/docs/api/images-generations-post)
  is the response/input oracle for that protocol, not other compatible vendors.

Vendor-specific MIME, mask and size restrictions not established here must be
verified at the corresponding protocol migration before strict enforcement.
An unavailable page is not evidence that the provider accepts arbitrary input.

## Execution and delivery invariants

`PreparedImageRequest` contains validated canonical values and a typed
`executionTarget`: SDK or custom protocol, or preparation fails as unconfigured.
Credentials and fetch are resolved from the provider instance, not persisted in
the Job. Provider-options namespace comes from the actual SDK implementation.
API model ID is preserved; it is not reconstructed from a display/canonical ID.

Existing Job providers, concurrency, timeout and one-attempt policy stay intact.
SDK/custom and immediate/task are separate dimensions from Job scheduling.
`recovery: 'abandon'` stays: restart must not resubmit accepted remote work.
Runtime resume queries a saved task ID and descriptor without submitting.

Task submission returns completed nonempty output or a mandatory task ID. Query
returns pending, completed nonempty output or an explicit failure. Persistence is
awaited before the first query. Transient network/408/409/429/5xx errors retry;
invalid JSON, schema, unknown status and ordinary 4xx fail immediately. Valid
pending resets consecutive errors. Preserve existing adaptive 0/3/10 s polling,
120 queries and 10 consecutive errors, and the separate FLUX cadence above.

Accepted but unfinished work gets one best-effort remote cancellation on local
failure/abort, using a fresh signal. Unsupported/failed cancellation logs that
remote work may continue. Completed remote work is never falsely cancelled when
local delivery fails. Aborted callers receive standard `AbortError`.

HTTP uses the injected fetch. Header precedence is authentication defaults →
provider → call → mandatory protocol, case-insensitively. FormData creates its
own content type. Resource downloads use the same proxy policy but do not leak
vendor authentication to arbitrary output hosts.

Results distinguish URLs from existing bytes. Outputs stage as auto-cleanup;
partial download success can be delivered with a warning, but write/association
failure or cancellation before commit fails delivery. Wait for started creates
before compensating only new, uncommitted files through FileManager. Record remote
usage even when local delivery fails.

Painting output-reference transaction is the delivery commit point. A late abort
does not roll it back. Tools retain the existing manual policy, promoted only at
handoff; this is not a durable chat-reference guarantee. No automatic recovery,
exactly-once delivery or zero-orphan guarantee is introduced.

## Verification

Use real registry producers and migrated database fixtures. Assert both valid and
invalid requests before HTTP, protocol responses, task-ID ordering, cancellation
and output-reference atomicity. Tests quoting external wire contracts cite their
source and actual retrieval date. For each boundary, deliberately remove the
relevant validation/field/order once, observe red, restore and observe green.
Characterization tests cannot certify external protocol correctness.
