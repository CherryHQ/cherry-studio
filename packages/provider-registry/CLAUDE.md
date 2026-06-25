# provider-registry — module instructions

The bundled AI **provider + model catalog**. This package has two faces:

- **Build-time**: a generation pipeline (`src/labs/` + `src/provider/` + `scripts/generate-catalog.ts`) that emits the three `data/*.json` files.
- **Runtime**: schemas + `registry-loader.ts` that the app reads those JSON files through.

Full architecture: [docs/architecture.md](docs/architecture.md). Consumer API: [README.md](README.md).

## Cardinal rule — NEVER hand-edit `data/*.json`

`data/models.json`, `data/providers.json`, `data/provider-models.json` are **PURE GENERATED ARTIFACTS**. Editing them by hand is always wrong — the next `pnpm generate` silently reverts your change, and **CI rejects it**: the `catalog-hand-edit-check` job fails any PR that touches `data/*.json` without a matching change under `src/` or `scripts/`.

To change the catalog, edit the **source** and regenerate:

| You want to change… | Edit | Then |
| --- | --- | --- |
| a model's metadata (capabilities, modalities, context/limits, name) | `src/labs/<creator>.ts` | `pnpm generate` |
| how a provider connects / which models it serves / its pricing & overrides | `src/provider/<provider>.ts` | `pnpm generate` |

`pnpm generate` reads the upstream catalogs (models.dev / OpenRouter) **live**; set `MODELSDEV_CACHE` / `OPENROUTER_CACHE` to a local file to cache them during dev. Always commit the **source change and the regenerated `data/*.json` together** — a data change with no source change reads as a hand-edit and CI blocks it.

## Source of truth

- **`src/labs/<creator>.ts`** — model **creators** (anthropic, openai, cohere, alibaba, …). Declares *what models exist* and their *intrinsic metadata*. Built with `defineLab`. A lab is the home for capabilities/modalities/context — **lab owns metadata**.
- **`src/provider/<provider>.ts`** — serving **providers** / gateways / clouds (dashscope, ppio, tokenhub, openrouter, aws-bedrock, …). Declares *how to connect* and *which models it serves* with per-provider `apiModelId`, pricing, and overrides. Built with `defineProvider` / `openaiCompatible` — **provider owns parameter support** (endpoints/transport, per-provider param sets).
- **models.dev + OpenRouter** — read live at generation time to enrich metadata/pricing for the models the registry references (not committed; `pnpm generate` fetches them).

## Rules when editing source

- **Hand-list models with full metadata.** A lab model is `{ id, name, capabilities, … }` — never a bare `{ id }`. Add `name` + the relevant `capabilities` / `contextWindow` / `maxOutputTokens` / modalities; without them the model resolves with no capabilities.
- **`imageGeneration`: lab carries `supports` (the param vocabulary) as the provider-agnostic DEFAULT; the provider carries `vendorTransport` (endpoint routing).** The runtime **replaces** `imageGeneration` wholesale (it does not deep-merge), so a model-level block must never contain a provider-specific `vendorTransport`, and any provider needing a custom endpoint restates the **full** block (supports + transport). See [docs/architecture.md#image-generation-design-b](docs/architecture.md#image-generation-design-b).
- **`idPrefixes` must be vendor-specific.** A prefix claims every catalog id matching it, so a generic prefix (`rerank`, `embed`) will mis-attribute other vendors' models. Use the creator's own namespace (`rerank-v`, `command`, `c4ai`, …).
- **A provider override whose `modelId` is not a base model must carry a standalone `name`** (vendor-exclusive). The catalog-invariants test fails on a dangling override (a `modelId` that is neither in `models.json` nor a named standalone).

## Verify (required before commit)

```bash
pnpm --filter @cherrystudio/provider-registry generate   # regenerate data/*.json from source + live upstream
pnpm --filter @cherrystudio/provider-registry test        # vitest: schema conformance + catalog invariants
```

Commit the regenerated `data/*.json` alongside your `src/` change. Generation also re-pulls live upstream, so the data diff may include unrelated metadata/pricing drift since the last run — that's expected. What CI enforces is only that **`data/*.json` never changes without a `src/`/`scripts/` change** (i.e. it was never hand-edited); correctness of the source itself is covered by the schema validation + catalog-invariant tests above and by code review.
