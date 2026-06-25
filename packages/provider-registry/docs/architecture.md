# provider-registry architecture

The catalog of AI **models** (what exists) and **providers** (how to reach them), plus the **M:N link** between them. It is a **code-generation pipeline**: hand-maintained TypeScript source + pinned upstream snapshots → three generated JSON files → read at runtime by the app.

> The three `data/*.json` files are **pure artifacts**. Never hand-edit them — edit the source and run `pnpm generate`. See [../CLAUDE.md](../CLAUDE.md).

## Data flow

```
  SOURCE (hand-maintained)                 GENERATOR                 OUTPUT (generated)            RUNTIME
  ────────────────────────                 ─────────                 ──────────────────            ───────
  src/labs/<creator>.ts   ─┐
    (defineLab)            │
  src/provider/<prov>.ts  ─┤──►  scripts/generate-catalog.ts  ──►   data/models.json          ─┐
    (defineProvider)       │       buildIndex                       data/providers.json        ├─► src/registry-loader.ts
  models.dev    (live)    ─┤       assignLabs   → ownedBy            data/provider-models.json ─┘     + src/schemas/*
  openrouter.ai (live)    ─┘       buildModels / buildProviders /                                    (app reads these)
                                   buildProviderModels
```

The pipeline never reads its own previous output — the JSON is a function of `src/**` plus the upstream catalogs (models.dev / OpenRouter, read **live**). It is deterministic for fixed inputs, but since upstream is live, regenerating on different days can absorb upstream metadata/pricing drift. The catalog is kept honest not by byte-reproducibility but by the [no-hand-edit guard](#the-no-hand-edit-guard).

## The three output files

| File | Role | Keyed by |
| --- | --- | --- |
| `data/models.json` | **Creator catalog** — every model that exists, with intrinsic metadata: `capabilities`, `inputModalities` / `outputModalities`, `contextWindow`, `maxOutputTokens`, `ownedBy`. | canonical model id |
| `data/providers.json` | **Connection config** — per provider: `endpointConfigs` (baseUrl + adapterFamily per endpoint type), `defaultChatEndpoint`, `apiFeatures`, `metadata.website`. | provider id |
| `data/provider-models.json` | **M:N overrides** — one row per *(provider, model)* a provider serves that needs non-derivable data: `apiModelId` mapping, per-provider `pricing`, `imageGeneration` transport, `disabled`, or a **standalone** vendor-exclusive model (carries its own `name`). | (providerId, modelId) |

First-party / standard cases emit **no** row — the runtime resolves `apiModelId → normalizeModelId → models.json` for all metadata, so a row only exists to carry what can't be derived.

## Source registries

### `src/labs/` — model creators (`defineLab`)

A lab declares a creator and its models. Fields:

- `id`, `name` — creator identity (`ownedBy` in the catalog).
- `models[]` — **hand-listed** models with full metadata (`{ id, name, capabilities, inputModalities, outputModalities, contextWindow, maxOutputTokens, imageGeneration? }`).
- `idPrefixes[]` — id namespaces this creator owns (e.g. `['command', 'c4ai', 'rerank-v', 'embed-v']`). Used to **claim** ids seen in upstream data. Must be vendor-specific — a generic prefix mis-attributes other vendors' models.
- `modelsDevProviders[]` — models.dev provider key(s) whose listing is this creator's clean catalog (metadata source).
- `families[]` — base-architecture families (weaker ownership signal than an id).
- `kind` — `'embedding'` / `'rerank'` for creators whose ids don't say so (bge / voyage / jina); auto-tags the capability (+ `vector` output for embeddings).
- `webSearch[]` — id-prefixes whose models carry the `web-search` capability (a curated capability upstream never reports).
- `fetchModels()` — optional: pull the creator's live `/models` list (most authoritative; keyless in CI → falls back to models.dev).

### `src/provider/` — serving providers (`defineProvider` / `openaiCompatible`)

A provider declares how to connect + what it serves. Fields:

- Connection: `id`, `name`, `endpointConfigs`, `defaultChatEndpoint`, `apiFeatures`, `metadata` — emitted to `providers.json` (minus `description`, which is templated).
- `modelsDevProvider` — models.dev key whose listing is this provider's served catalog (with per-model pricing). **Generation-only**, not emitted to `providers.json`.
- `fetchModels()` — or pull the served list from the provider's own API.
- `overrides[]` — manual `ProviderModelOverride`s for what the runtime can't derive: bedrock arns, `apiModelId` maps, `pricing`, `imageGeneration` transport, `disabled`, standalone models.

`openaiCompatible({ id, name, baseUrl, … })` is the helper for the ~half of providers that are a plain OpenAI-compatible endpoint.

## Generation pipeline (`scripts/generate-catalog.ts`)

1. **`load`** — fetch the upstream catalogs live (or a local file via `MODELSDEV_CACHE` / `OPENROUTER_CACHE`), validate with zod.
2. **`buildIndex`** — a canonical-id → metadata index, **unioned across sources**. models.dev is read only for the creator providers a lab forward-declares (clean listings); OpenRouter is always read (clean org/model ids). Host/gateway listings are ignored to avoid host-prefixed dup ids.
3. **`assignLabs`** — assign each canonical id an owning lab (`ownedBy`), most-explicit signal first:
   - **pass 1 — explicit identity**: the id names the creator (`fetchModels` list, hand-listed `models`, `idPrefixes`).
   - **pass 2 — family**: base architecture (`families`), weaker than an id.
   - **pass 3 — provider listing**: leftovers a creator's models.dev listing covers.
   - Unclaimed ids are **dropped** (no lab owns them → not a real catalog model).
4. **`buildModels`** — materialize `models.json` rows from claims, apply hand-listed lab models (always win), tag `embedding`/`rerank`/`web-search`.
5. **`buildProviders`** — `providers.json` from each provider's connection config (drops generation-only fields, templates `description`).
6. **`buildProviderModels`** — `provider-models.json`: each provider's manual `overrides` + (if it declares `modelsDevProvider`) one priced row per served model. A `modelId` resolves to a base row, or is a standalone carrying `name`.

### Canonicalization

`canonOf(id)` (build-time) and `normalizeModelId(id)` (runtime) share the same pipeline: lowercase, strip `org/` and host/vendor prefixes (`zai-org-`, bedrock `region.vendor.`), strip variant suffixes (`-free`/`-thinking`), quantization (`-fp8`), trailing release dates, and normalize version separators (`4.6` → `4-6`). The catalog **keeps** param-size (`qwen3-235b` ≠ `qwen3-30b`); the runtime resolver additionally strips it so a user's sized id resolves to the base.

- **`prefixHit(id, p)`** — a `-` or a digit ends the prefix word, so `qwen` claims `qwen-max` and `qwen3-30b`. This is why generic prefixes over-claim.
- **`crossVendorHost`** — a host listing (e.g. amazon-bedrock) re-lists *other* creators' models as `[region.]vendor.model` arns. Most canonicalize fine; the exception is a vendor with **bare** bedrock ids (`deepseek.r1` → `r1`) that would fold over the real model — those are skipped so the real creator supplies them.

## Image generation (Design B)

> **Lab owns metadata; provider owns parameter support.**

`imageGeneration` has two parts that live in different places:

| part | what | where |
| --- | --- | --- |
| `supports` | the param vocabulary (aspectRatio, size, seed, renderingSpeed, …) | **lab** (model-level) — the provider-agnostic DEFAULT |
| `vendorTransport` | endpoint routing (`/v3/async/…`, `/v1/models/…/predictions`) | **provider** override — differs per provider |

The runtime **replaces** `imageGeneration` wholesale — it does **not** deep-merge (`getImageGenerationSupport`: `override.imageGeneration ?? model.imageGeneration`). Consequences:

- A model-level block must **never** carry a provider-specific `vendorTransport`, or every non-overriding provider inherits the wrong endpoint.
- A provider that needs a custom endpoint carries the **full** block (its own `supports` + `vendorTransport`), since it supersedes the model-level default entirely.

## The no-hand-edit guard

`data/*.json` must only ever change as a product of a source change. CI enforces this with a **path-coupling check** (`.github/workflows/ci.yml` › `catalog-hand-edit-check`, via `dorny/paths-filter`):

> if a PR changes `packages/provider-registry/data/**` but **nothing** under `src/**` or `scripts/**`, it fails — the JSON was hand-edited.

This is deliberately cheap (no regeneration, no committed snapshots): it catches the one thing that matters — **editing the generated artifact directly** — without needing a deterministic build. Its limits, by design:

- A *combined* edit slips through (changing a `.ts` **and** also hand-tweaking the JSON inconsistently) — code review catches that.
- A data change must always ride with a source change; there's no standalone "refresh upstream only" commit (upstream drift is absorbed whenever you regenerate during a source edit).

Source **correctness** (as opposed to "the JSON matches the source") is covered separately: zod schema validation at generation time, the catalog-invariant tests (`src/__tests__/catalog-invariants.test.ts`), and PR review of the human-readable `.ts`.

## Runtime side

The app does **not** import the generation pipeline. It reads the JSON via `src/registry-loader.ts` (the `@cherrystudio/provider-registry/node` entry) + the `src/schemas/*` types, and resolves a model with `normalizeModelId`. `registry-loader` / `patterns` / `schemas` are the published surface; `labs` / `provider` / `scripts` are build-time only (not in `dist`).
