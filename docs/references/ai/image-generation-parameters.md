---
description: Data-driven image-generation params — registry supports to form fields, canonical bag to vendor wire via WireProfile
sources:
  - packages/provider-registry/src/schemas/imageParamCatalog.ts
  - src/renderer/pages/paintings
  - src/main/ai/provider/custom/wire/wireProfile.ts
  - src/main/ai/provider/custom/tasks/imageGenerationJobHandler.ts
---

# Image-Generation Parameterized Architecture

## Scope and migration status

This page describes the current image-capability design revision v2 and request pipeline. The
[capability and execution contract](image-generation-contract.md) records the
accepted target, including delivery work that is not implemented yet.

The catalog and resolver now use base capabilities plus differences, not
`modes` or whole-block provider overrides. The image contract is published in
registry schema v4 with minimum application version 2.1.5; its frozen validator
checks combined creator/provider input and operation differences. Published
registry v1/v2/v3 baselines remain unchanged. Consumers and fixtures use the new
contract. Focused capability and parameter acceptance has run; output staging
and Main-owned painting delivery remain separate unfinished work.

## Current request flow

```text
creator base + provider differences
  → resolveImageGenerationSupport
  → resolveImageCapability(operation, hasImages)
      ├─ renderer fields and request preflight
      └─ tool schema and Main authoritative validation
  → prepareImageExecution → fixed ImageExecutionTarget
      ├─ scheduling: job → existing Job → custom transport
      └─ scheduling: direct → SDK model or custom ImageModelV3 adapter
  → Main persists generated output → AiImageResult.files
```

`operation` is `generate`, `remix` or `upscale`; `inputImages` is independent
input. Ordinary generation may accept no images, optional references or require
images. Those distinctions come from `inputs`, not an inferred `edit` mode.
Protocol kind and Job scheduling are also separate: a custom protocol can run
directly without a Job.

## Capability declarations and ownership

The exact shapes live in [the registry schema](../../../packages/provider-registry/src/schemas/model.ts),
not a duplicate interface in this document.

| Fact | Owner |
| --- | --- |
| Canonical parameter value type and default wire spelling | `IMAGE_PARAM_CATALOG` |
| Available parameters and their constraints | Effective capability `supports`, interpreted by `buildImageParamSchema` |
| Image count, prompt, mask and media-type facts | Capability `inputs`; unknown facts remain explicit |
| Input-specific or genuine operation differences | `withImages` / `operations` |
| Provider-specific endpoint and sync/task declaration | `protocol` |
| Provider instance, API model ID and executable binding | Main preparation and `ImageExecutionTarget` |
| Vendor field placement and response parsing | SDK adapter or custom transport |

`ProviderRegistryService.getImageGenerationSupport` resolves a creator base plus
the provider-model override through `resolveImageGenerationSupport`. Only this
capability block uses its field-level merge contract. Each supplied
`SupportSpec` and protocol replaces the complete prior value; arrays do not
append. Standalone provider models need enough input facts to form a complete
capability.

The [registry override rules](../../../packages/provider-registry/docs/architecture.md#override-rules)
define inheritance and the distinct meanings of `null`: removing a parameter,
removing a protocol declaration, clearing an image-input difference, or disabling
an operation are not interchangeable. In particular, `withImages: null` does not
forbid images, and `protocol: null` does not select an SDK.

After provider-model merging, `resolveImageCapability` applies `withImages`
**only for `generate` with images**, then applies `operations.generate` last.
`remix` and `upscale` inherit the base plus their own declared differences,
without `withImages`. Missing support is `unconfigured`; an undeclared
non-generate operation or an explicitly disabled operation is `unsupported`.

## Read half — effective capability to form

[`useImageGenerationSupport`](../../../src/renderer/pages/paintings/hooks/useImageGenerationSupport.ts)
reads the provider-model capability through DataApi.
[`imageGenerationToFields`](../../../src/renderer/pages/paintings/form/imageGenerationToFields.ts)
takes `{ operation, hasImages }`, resolves the effective capability, and maps its
`supports` through `SupportSpec.type` and the canonical-key label map.

The form writes draft values to `painting.params`.
[`computeModelFieldReset`](../../../src/renderer/pages/paintings/utils/computeModelFieldReset.ts)
handles parameter resets/defaults when selection changes. Draft representation
is not the vendor request representation.

[`IMAGE_PARAM_CATALOG`](../../../packages/provider-registry/src/schemas/imageParamCatalog.ts)
owns canonical value types and `wireName`; `SupportSpec` contributes the
model-specific options and constraints. `buildImageParamSchema` combines these
facts for draft parsing, Tool JSON schema and authoritative request validation.
Range `step` is a control interaction increment, not a `multipleOf` restriction;
minimum/maximum and the catalog's integer/number type constrain valid values.

`imageParamsSchema` normalizes numeric strings from form/IPC inputs. Tool JSON
numbers must already be numbers: strings, booleans and arrays are not coerced.
Neither boundary fills model defaults; missing values remain missing and
explicit `0`/`false` survive. The loose
[`buildParamsSchema`](../../../packages/provider-registry/src/utils/buildParamsSchema.ts)
clears invalid draft values and retains the custom-size widget sentinel; it is
not the authoritative submit validator.

## Write half — canonical request to execution

### 1. Renderer preflight and IPC

[`canonicalGenerate`](../../../src/renderer/pages/paintings/model/canonicalGenerate.ts)
resolves the effective capability, checks prompt/image-count requirements,
removes empty or inactive draft fields and composes custom dimensions. It uses
[`buildImageRequestParamsSchema`](../../../packages/provider-registry/src/utils/buildImageRequestParamsSchema.ts)
for strict submitted-value validation. Invalid explicit values fail; there is
no soft fallback to the raw draft.

It sends `operation`, `paramValues` and independent `inputImages` through
`ai.image.generate`. The [IPC schema](../../../src/shared/ipc/schemas/ai.ts)
validates the canonical input shape; it does not replace Main's model-specific
validation.

The [image Tool schema](../../../src/main/ai/tools/generateImageTool.ts) uses the
same field constraints, restricted to the Tool's ordinary-generation subset.
Its [entry adapter](../../../src/main/ai/tools/painting.ts) composes paired
`customSize` into `size` before authoritative validation and file reads. A
`custom` selection requires dimensions; conflicting concrete and custom sizes
fail as invalid input. The auxiliary key and sentinel never reach execution.

### 2. Main preparation

[`AiService.generateImage`](../../../src/main/ai/AiService.ts) resolves provider
and model, then delegates to
[`prepareImageExecution`](../../../src/main/ai/utils/prepareImageRequest.ts).
Preparation validates operation, prompt, image count, input representation and
canonical parameters before credential resolution or execution.

[`resolveImageExecutionTarget`](../../../src/main/ai/provider/imageExecutionTarget.ts)
binds the API model ID, endpoint and SDK/custom execution choice. Native protocols
without a required binding fail as unavailable rather than silently becoming
SDK calls. Capability declarations alone do not prove an endpoint is executable.

For registry custom protocols,
[`imageTransportDescriptorFor`](../../../src/main/ai/provider/custom/imageTransport.ts)
derives `{ id, endpoint, isSync }` from the effective protocol. The descriptor is
typed backend routing data, not a user parameter, and contains no `mode`.

### 3. Terminal encoding and dispatch

[`executeImageRequest`](../../../src/main/ai/utils/executeImageRequest.ts)
dispatches the prepared scheduling choice. The current branches partition
canonical parameters independently; they do not both encode one request:

- The direct path uses [`buildSdkImageOptions`](../../../src/main/ai/provider/imageSdk.ts).
  `splitParamValues` and `AI_SDK_NATIVE_BINDINGS` map native options such as
  `numImages → n`; the remaining canonical bag reaches the selected SDK adapter.
- SDK provider-options encoding uses
  [`buildVendorProviderOptions`](../../../src/main/ai/provider/custom/wire/buildImageRequest.ts)
  and [`WIRE_REGISTRY`](../../../src/main/ai/provider/custom/wire/wireProfile.ts).
  Profiles describe forwarding or nested placement, and `wireName` supplies the
  default field spelling. Delivery uses `sdkConfig.providerOptionsKey`, the
  namespace the actual SDK model reads, not necessarily the provider ID.
- The Job path currently calls `splitParamValues` before enqueueing. Its payload
  carries the fixed native target, structured values and canonical
  `providerParams`. The custom transport builds its vendor-specific envelope;
  it must not read SDK wire spellings from this bag.

The generic wire encoder does not interpret `'auto'`. A terminal rule owns
whether a value is sent or omitted: OpenAI `quality`, `background` and
`moderation` retain literal `auto`; Google automatic aspect ratio and image
resolution omit their individual `imageConfig` fields. Other explicitly set
fields remain intact. The encoder still omits absent/empty contributions, not
`0` or `false`. Broader terminal-encoding consolidation remains follow-up work.

### 4. Task and output ownership

The [transport contract](../../../src/main/ai/provider/custom/imageTransport.ts)
owns submission and protocol states. The
[shared runtime](../../../src/main/ai/provider/custom/imageTransportRuntime.ts)
awaits task-ID persistence before polling and owns retry, timeout and remote
cancellation. The
[Job handler](../../../src/main/ai/provider/custom/tasks/imageGenerationJobHandler.ts)
bridges durable inputs, task metadata, progress and output persistence.

Existing scheduling and `recovery: 'abandon'` remain unchanged. Runtime query
resumption does not imply Jobs automatically resume after restart. The direct
path and Job path return persisted output files through `AiImageResult.files`,
not raw data URLs across IPC.

Output staging with complete failed-delivery compensation and painting
association-before-response remain targets in the
[execution and delivery contract](image-generation-contract.md#execution-and-delivery-invariants).
This page does not claim those guarantees are implemented.

## Changing a model or parameter

1. Edit creator/provider **source declarations**, never generated `data/*.json`.
   Declare provider differences rather than copying the base support block.
2. Reuse a canonical parameter key. A new key needs catalog value/wire metadata,
   a form label and the [i18n workflow](../i18n/README.md#translation-completion-in-pull-requests).
3. Trace the effective capability through its actual SDK or custom transport.
   A field declaration or passthrough flag alone is not proof of delivery.
4. Regenerate from the reviewed inputs and keep the catalog diff in scope.
   The v2 image migration does not import upstream model or pricing updates.
5. Validate the promised behavior with producer-derived fixtures and independent
   protocol evidence. A snapshot of a self-authored payload is not a protocol
   oracle. The staged migration still needs its remaining acceptance checks.
