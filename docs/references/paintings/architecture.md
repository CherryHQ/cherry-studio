# Paintings Architecture

This document describes the refactored `paintings` module in the renderer, including its layering, type model, provider contract, runtime state design, component hierarchy, data flow, and the async/cancellation fixes completed during this round.

## Goals

The refactor was intended to replace the old page-centric implementation with a modular paintings architecture.

Main goals:

- Separate route/provider selection from page rendering.
- Separate paintings page orchestration from provider-specific business logic.
- Separate painting business data from request runtime state and view state.
- Introduce a stable provider contract for adding and maintaining providers.
- Centralize persistence and DTO mapping logic.
- Make cancellation behavior consistent across providers.

## Module Layout

The new structure is organized into five layers:

1. `route`
2. `page` (`index.tsx`, layout primitives, glue hooks/components)
3. `providers`
4. `model`
5. `form`

Key entry points:

- [index.tsx](../../../src/renderer/src/pages/paintings/index.tsx) (page entry / route shell)
- [provider.ts](../../../src/renderer/src/pages/paintings/providers/shared/provider.ts)
- [paintingData.ts](../../../src/renderer/src/pages/paintings/model/types/paintingData.ts)

## Layer Responsibilities

### Route Layer

The route layer resolves the active provider and owns navigation-related concerns.

Primary file:

- [index.tsx](../../../src/renderer/src/pages/paintings/index.tsx)

Responsibilities:

- Read provider from route params.
- Read and update default provider preference.
- Validate provider availability.
- Handle OVMS support checks.
- Choose the active provider definition.
- Render `PaintingsRoute` at `/app/paintings/`; active provider is React state plus `feature.paintings.default_provider` (not the URL).

The route layer should not perform generation, persistence mapping, or field rendering.

### Page layer

The page layer owns provider-agnostic shell state and orchestration.

Primary files:

- [index.tsx](../../../src/renderer/src/pages/paintings/index.tsx)
- [PaintingPrimitives.ts](../../../src/renderer/src/pages/paintings/PaintingPrimitives.ts)
- [painting-theme.css](../../../src/renderer/src/pages/paintings/painting-theme.css)
- [PaintingStrip.tsx](../../../src/renderer/src/pages/paintings/components/PaintingStrip.tsx)
- [PaintingPromptLeadingActions.tsx](../../../src/renderer/src/pages/paintings/components/PaintingPromptLeadingActions.tsx)
- [usePaintingGeneration.ts](../../../src/renderer/src/pages/paintings/hooks/usePaintingGeneration.ts)
- [usePaintingGenerationGuard.ts](../../../src/renderer/src/pages/paintings/hooks/usePaintingGenerationGuard.ts)
- [usePaintingProviderRuntime.ts](../../../src/renderer/src/pages/paintings/hooks/usePaintingProviderRuntime.ts)
- [usePaintingItems.ts](../../../src/renderer/src/pages/paintings/hooks/usePaintingItems.ts)

Responsibilities:

- Build default `PaintingData` for the active provider/tab.
- Resolve current db mode from provider tab.
- Load current model options.
- Coordinate selected painting, prompt editing, history switching, deletion, and generation.
- Create `AbortController` for a generation request.
- Build `GenerateContext` for providers.
- Render common shell pieces such as sidebar, artboard, prompt bar, and history strip.

### Provider Layer

The provider layer defines the provider-specific capabilities and implementation details.

Primary files:

- [registry.ts](../../../src/renderer/src/pages/paintings/providers/registry.ts)
- [provider.ts](../../../src/renderer/src/pages/paintings/providers/shared/provider.ts)

Representative providers:

- [tokenflux](../../../src/renderer/src/pages/paintings/providers/tokenflux)
- [ppio](../../../src/renderer/src/pages/paintings/providers/ppio)
- [aihubmix](../../../src/renderer/src/pages/paintings/providers/aihubmix)
- [dmxapi](../../../src/renderer/src/pages/paintings/providers/dmxapi)
- [ovms](../../../src/renderer/src/pages/paintings/providers/ovms)
- [silicon](../../../src/renderer/src/pages/paintings/providers/silicon)
- [zhipu](../../../src/renderer/src/pages/paintings/providers/zhipu)
- [newapi](../../../src/renderer/src/pages/paintings/providers/newapi)

Provider responsibilities:

- Define provider tabs and mode mapping.
- Define model loading strategy.
- Define field schema.
- Define optional slot overrides.
- Implement provider-specific generation behavior.
- Implement provider-specific service access and polling behavior.

### Model Layer

The model layer centralizes business data types, runtime state, mappers, services, and errors.

Primary files:

- [paintingData.ts](../../../src/renderer/src/pages/paintings/model/types/paintingData.ts)
- [paintingGenerateError.ts](../../../src/renderer/src/pages/paintings/model/paintingGenerateError.ts)
- [paintingAbortControllerStore.ts](../../../src/renderer/src/pages/paintings/model/paintingAbortControllerStore.ts)
- [paintingGenerationService.ts](../../../src/renderer/src/pages/paintings/model/paintingGenerationService.ts)
- [recordToPaintingData.ts](../../../src/renderer/src/pages/paintings/model/mappers/recordToPaintingData.ts)
- [paintingDataToCreateDto.ts](../../../src/renderer/src/pages/paintings/model/mappers/paintingDataToCreateDto.ts)
- [paintingDataToUpdateDto.ts](../../../src/renderer/src/pages/paintings/model/mappers/paintingDataToUpdateDto.ts)

### Form Layer

The form layer renders provider-configured fields using a shared rendering pipeline.

Primary files:

- [PaintingFieldRenderer.tsx](../../../src/renderer/src/pages/paintings/form/PaintingFieldRenderer.tsx)
- [fieldRegistry.ts](../../../src/renderer/src/pages/paintings/form/fieldRegistry.ts)
- [providerFieldSchema.ts](../../../src/renderer/src/pages/paintings/providers/shared/providerFieldSchema.ts)

Responsibilities:

- Render fields from schema-driven definitions.
- Map generic field types to specialized field components.
- Keep field rendering reusable across providers.

## Type System

### PaintingData

The core front-end business object is `PaintingData`.

Primary file:

- [paintingData.ts](../../../src/renderer/src/pages/paintings/model/types/paintingData.ts)

Design intent:

- Represent what a painting is in business terms.
- Hold prompt, model, parameters, file references, and provider-specific business data.
- Hold resumable task handles such as `taskId` and `generationId`.

Specialized provider-specific state is represented through partial composition:

- `SiliconPaintingData`
- `GeneratePaintingData`
- `EditPaintingData`
- `RemixPaintingData`
- `ScalePaintingData`
- `DmxapiPaintingData`
- `TokenFluxPaintingData`
- `OvmsPaintingData`
- `PpioPaintingData`

### Runtime State

Runtime request state is intentionally separated from painting business data.

Loading and in-flight generation flags live in page/hook state (see [usePaintingGeneration.ts](../../../src/renderer/src/pages/paintings/hooks/usePaintingGeneration.ts)).

The actual `AbortController` instances are stored separately:

- [paintingAbortControllerStore.ts](../../../src/renderer/src/pages/paintings/model/paintingAbortControllerStore.ts)

This avoids mixing non-serializable request control objects into the persistent or cache-backed runtime object.

### View State

View state is not explicitly defined as a separate type; it lives in [`index.tsx`](../../../src/renderer/src/pages/paintings/index.tsx) as React component state plus shared hooks (`usePaintingItems`, `usePaintingModelCatalog`, …).

Examples:

- Selected painting (`currentPainting` / persisted flag)
- Model selector open state

Primary files:

- [index.tsx](../../../src/renderer/src/pages/paintings/index.tsx)

## Naming Changes

The previous `PaintingDraft` naming was replaced by `PaintingData` to better reflect its actual role.

Important naming changes:

- `PaintingDraft` -> `PaintingData`
- `recordToDraft` -> `recordToPaintingData`
- `draftToCreateDto` -> `paintingDataToCreateDto`
- `draftToUpdateDto` -> `paintingDataToUpdateDto`
- `createDraft` -> `createPaintingData`

This naming change is important because the object no longer represents a short-lived editing draft only. It now represents the main business object used by the renderer.

## Provider Contract

Primary file:

- [provider.ts](../../../src/renderer/src/pages/paintings/providers/shared/provider.ts)

The shared provider contract includes:

- `mode`
  - `tabs`
  - `defaultTab`
  - `tabToDbMode`
  - `getModels`
  - `createPaintingData`
- `fields`
  - `byTab`
  - `onModelChange`
- `prompt`
  - `placeholder`
  - `disabled`
- `image`
  - `onUpload`
  - `getPreviewSrc`
  - `placeholder`
- `slots`
  - `headerExtra`
  - `sidebarExtra`
  - `centerContent`
  - `artboardOverrides`
- `generate`

This contract allows the paintings page shell to stay generic while each provider supplies only its differences.

## Persistence and Data Mapping

Persistence is centralized through:

- [usePaintings.ts](../../../src/renderer/src/hooks/usePaintings.ts)

The mapping pipeline is:

- DataApi record -> `recordToPaintingData`
- `PaintingData` -> create DTO
- `PaintingData` -> update DTO

This means:

- UI code does not manipulate DTO shape directly.
- Provider code does not call persistence APIs directly.
- Persistence concerns remain centralized and testable.

## Request Lifecycle

Generation follows this lifecycle:

1. User clicks generate in the prompt bar.
2. The page creates `AbortController`.
3. Generation hook / provider receive `GenerateInput` with the signal.
4. Provider `generate(...)` runs.
5. `runPainting(...)` wraps the provider operation.
6. Runtime loading state is set.
7. Provider-specific request executes.
8. Provider returns URLs, base64, or files.
9. `processPaintingResult(...)` normalizes and writes files.
10. `patchPainting(...)` writes resulting files back into `PaintingData`.
11. Runtime loading state is cleared.

Shared request helpers:

- [paintingGenerationService.ts](../../../src/renderer/src/pages/paintings/model/paintingGenerationService.ts)

## Component Hierarchy

```text
+----------------------------------------------------------------------------------+
| Route: /app/paintings/$                                                          |
| PaintingsRoute                                                                   |
| - resolve active provider                                                        |
| - validate provider availability                                                 |
| - build provider definition                                                      |
+-----------------------------------+----------------------------------------------+
                                    |
                                    v
+----------------------------------------------------------------------------------+
| PaintingPage                                                                     |
| - compose hooks (generation, guards, catalogs)                                 |
| - useModelLoader                                                                 |
| - build GenerateContext                                                          |
+-----------------------------------+----------------------------------------------+
                                    |
                                    v
+----------------------------------------------------------------------------------+
| Painting shell (layout inside PaintingPage)                                    |
|                                                                                  |
|  +------------------+  +------------------------------------+  +---------------+ |
|  | Navbar           |  | Center / Artboard Area             |  | PaintingsList | |
|  +------------------+  | - provider.slots.centerContent     |  | - select      | |
|                        | - default Artboard                 |  | - delete      | |
|  +------------------+  | - current image navigation         |  | - reorder     | |
|  | Sidebar          |  +------------------------------------+  +---------------+ |
|  | PaintingSettings |                                                            |
|  | - provider select | +------------------------------------------------------+  |
|  | - model select    | | Prompt Bar                                            |  |
|  | - config items    | | PaintingPromptBar                                     |  |
|  +---------+---------+ | - prompt editing                                      |  |
|            |           | - generate trigger                                    |  |
|            v           +------------------------------------------------------+  |
|  +-------------------------------+                                               |
|  | PaintingFieldRenderer         |                                               |
|  | - schema driven render        |                                               |
|  | - fieldRegistry dispatch      |                                               |
|  +-------------------------------+                                               |
+----------------------------------------------------------------------------------+
```

## Main Data Flow

```text
[Route]
  PaintingsRoute
      |
      v
[Provider Selection]
  ProviderRegistry / createNewApiProvider
      |
      v
[Paintings Page]
  index.tsx (shell + hooks)
      |
      +-------------------------------------------------------------+
      |                                                             |
      v                                                             v
[Persistent Data Path]                                     [Generation Path]

  usePaintings                                                click Generate
      |                                                            |
      v                                                            v
  DataApi GET /paintings                                     create AbortController
      |                                                            |
      v                                                            v
  PaintingRecord[]                                           build GenerateContext
      |                                                            |
      v                                                            v
  recordToPaintingData                                        provider.generate(...)
      |                                                            |
      v                                                            v
  PaintingData[]                                              runPainting(...)
      |                                                            |
      | user edit prompt/config/image                              +----------------------+
      v                                                            | setIsLoading(true)   |
  patchPainting / patchPaintingById                                | runtime store        |
      |                                                            +----------------------+
      v                                                            |
  usePaintings.updatePainting                                      v
      |                                                     provider request / polling
      v                                                            |
  debounce patch queue                                              +----------------------+
      |                                                            | patchPainting(...)   |
      |                                                            | generationStatus     |
      |                                                            | taskStatus           |
      |                                                            | taskId/generationId  |
      v                                                            +----------------------+
  paintingDataToUpdateDto                                           |
      v                                                            v
  paintingCollectionService.updatePaintingRecord             urls / base64s / files
      |                                                            |
      v                                                            |
  DataApi PATCH /paintings/:id                                     v
                                                                    |
                                                                    v
                                                             processPaintingResult
                                                                    |
                                                                    v
                                                             download / save files
                                                                    |
                                                                    v
                                                             FileManager.addFiles
                                                                    |
                                                                    v
                                                             patchPainting({ files })
                                                                    |
                                                                    v
                                                             debounce persistence path

[Cancel Path]
  user clicks Cancel
      |
      v
  abortPaintingGeneration(paintingId)
      |
      v
  AbortController.abort()
      |
      v
  provider request / polling stops

[Delete Path]
  user deletes painting
      |
      v
  onDeletePainting
      |
      +--> abortPaintingGeneration
      +--> clearPaintingAbortController
      +--> clearPaintingRuntimeState
      +--> deletePaintingRecord
```

## Async and Cancellation Fixes Completed

### 1. Prevent deleted paintings from being recreated by late async updates

Problem:

- After deletion, a late callback could still call `patchPaintingById(...)`.
- Missing records were previously recreated through `createPainting(...)`.

Fix:

- [index.tsx](../../../src/renderer/src/pages/paintings/index.tsx) coordinates deletion navigation and avoids stale mutations where applicable.

Solution:

- Keep a set of deleted painting ids.
- Ignore late patches for deleted ids.
- Prevent painting resurrection after deletion.

### 2. TokenFlux cancellation now aborts polling correctly

Files:

- [service.ts](../../../src/renderer/src/pages/paintings/providers/tokenflux/service.ts)
- [generate.ts](../../../src/renderer/src/pages/paintings/providers/tokenflux/generate.ts)

Changes:

- `signal` now propagates through generation creation and polling.
- Polling `setTimeout` is cancelled on abort.
- Abort now raises standard `AbortError`.
- `generationStatus` transitions to `cancelled` on abort.

### 3. PPIO cancellation now interrupts requests and polling wait

Files:

- [service.ts](../../../src/renderer/src/pages/paintings/providers/ppio/service.ts)
- [generate.ts](../../../src/renderer/src/pages/paintings/providers/ppio/generate.ts)

Changes:

- External abort signal is now passed into request execution.
- Request timeout and external abort are handled separately.
- Polling sleep is now abortable.
- `taskStatus` transitions to `cancelled` on abort.

### 4. Aihubmix cancellation is now consistent across branches

File:

- [generate.ts](../../../src/renderer/src/pages/paintings/providers/aihubmix/generate.ts)

Changes:

- `signal` added to `AI.generateImage(...)` calls.
- `signal` added to Gemini branch fetch.
- `signal` added to `V_3 generate` fetch.
- `signal` added to `V_3 remix` fetch.

Previously only the generic fetch branch honored cancellation.

## Testing

Relevant tests:

- [usePaintingGenerationGuard.test.ts](../../../src/renderer/src/pages/paintings/hooks/__tests__/usePaintingGenerationGuard.test.ts)
- [paintingProviderMode.test.ts](../../../src/renderer/src/pages/paintings/utils/__tests__/paintingProviderMode.test.ts)
- [TokenFluxService.test.ts](../../../src/renderer/src/pages/paintings/providers/tokenflux/__tests__/TokenFluxService.test.ts)
- [PpioService.test.ts](../../../src/renderer/src/pages/paintings/providers/ppio/__tests__/PpioService.test.ts)

Current verification status:

- `pnpm format`: passed
- targeted `eslint` on modified painting files: passed
- renderer `vitest`: blocked in this environment by missing `@vitest/web-worker`

## Known Limitations

1. Task recovery is not fully closed-loop yet.
   `taskId` and `generationId` are stored correctly in `PaintingData`, but automatic refresh-and-resume flow still needs to be implemented.

2. Form schema typing is still weak.
   The form system currently relies heavily on `Record<string, unknown>` and string keys.

3. Provider internal execution style is still not fully uniform.
   The contract is unified, but some provider implementations remain more ad hoc internally.

## Future Work

- Implement automatic task recovery based on persisted task handles.
- Strengthen provider field schema typing with provider-specific generics.
- Standardize provider-side request and result helpers further.
- Restore renderer test environment so this module can be verified reliably in CI and local development.

## Summary

This refactor changed the paintings feature from a page-heavy implementation into a modular page + provider architecture.

The main architectural gains are:

- clear layer boundaries
- a stable provider extension contract
- cleaner type semantics via `PaintingData`
- separated business data, runtime state, and view state
- centralized persistence and mapping
- consistent cancellation behavior across providers

The architecture direction is strong and correct. The remaining work is mainly about tightening type safety, completing recovery behavior, and hardening verification infrastructure.
