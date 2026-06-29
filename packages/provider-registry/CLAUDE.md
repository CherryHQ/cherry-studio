# provider-registry — module instructions

The bundled AI **provider + model catalog**. This package has two faces:

- **Build-time**: a generation pipeline (`src/creators/` + `src/providers/` + `scripts/generate-catalog.ts`) that emits the three `data/*.json` files.
- **Runtime**: schemas + `registry-loader.ts` that the app reads those JSON files through.

Full architecture: [docs/architecture.md](docs/architecture.md). Consumer API: [README.md](README.md).

## Cardinal rule — NEVER hand-edit `data/*.json`

`data/models.json`, `data/providers.json`, `data/provider-models.json` are **PURE GENERATED ARTIFACTS**. Editing them by hand is always wrong — the next `pnpm generate` silently reverts your change, and **CI rejects it**: the `catalog-hand-edit-check` job fails any PR that touches `data/*.json` without a matching change under `src/` or `scripts/`.

To change the catalog, edit the **source** and regenerate:

| You want to change… | Edit | Then |
| --- | --- | --- |
| a model's metadata (capabilities, modalities, context/limits, name) | `src/creators/<creator>.ts` | `pnpm generate` |
| how a provider connects / which models it serves / its pricing & overrides | `src/providers/<provider>.ts` | `pnpm generate` |

`pnpm generate` reads the upstream catalogs (models.dev / OpenRouter) **live**; set `MODELSDEV_CACHE` / `OPENROUTER_CACHE` to a local file to cache them during dev. Always commit the **source change and the regenerated `data/*.json` together** — a data change with no source change reads as a hand-edit and CI blocks it.

## Source of truth

- **`src/creators/<creator>.ts`** — model **creators** (anthropic, openai, cohere, alibaba, …). Declares *what models exist* and their *intrinsic metadata*. Built with `defineCreator`. A creator is the home for capabilities/modalities/context — **creator owns metadata**.
- **`src/providers/<provider>.ts`** — serving **providers** / gateways / clouds (dashscope, ppio, tokenhub, openrouter, aws-bedrock, …). Declares *how to connect* and *which models it serves* with per-provider `apiModelId`, pricing, and overrides. Built with `defineProvider` / `openaiCompatible` — **provider owns parameter support** (endpoints/transport, per-provider param sets).
- **models.dev + OpenRouter** — read live at generation time to enrich metadata/pricing for the models the registry references (not committed; `pnpm generate` fetches them).

## Rules when editing source

- **Hand-list models with full metadata.** A creator model is `{ id, name, capabilities, … }` — never a bare `{ id }`. Add `name` + the relevant `capabilities` / `contextWindow` / `maxOutputTokens` / modalities; without them the model resolves with no capabilities.
- **`imageGeneration`: creator carries `supports` (the param vocabulary) as the provider-agnostic DEFAULT; the provider carries `vendorTransport` (endpoint routing).** The runtime **replaces** `imageGeneration` wholesale (it does not deep-merge), so a model-level block must never contain a provider-specific `vendorTransport`, and any provider needing a custom endpoint restates the **full** block (supports + transport). See [docs/architecture.md#image-generation-design-b](docs/architecture.md#image-generation-design-b).
- **`idPrefixes` must be vendor-specific.** A prefix claims every catalog id matching it, so a generic prefix (`rerank`, `embed`) will mis-attribute other vendors' models. Use the creator's own namespace (`rerank-v`, `command`, `c4ai`, …).
- **A provider override whose `modelId` is not a base model must carry a standalone `name`** (vendor-exclusive). The catalog-invariants test fails on a dangling override (a `modelId` that is neither in `models.json` nor a named standalone).

## Verify (required before commit)

```bash
pnpm --filter @cherrystudio/provider-registry generate   # regenerate data/*.json from source + live upstream
pnpm --filter @cherrystudio/provider-registry test        # vitest: schema conformance + catalog invariants
```

Commit the regenerated `data/*.json` alongside your `src/` change. Generation also re-pulls live upstream, so the data diff may include unrelated metadata/pricing drift since the last run — that's expected. CI enforces sync in **both** directions: the `catalog-hand-edit-check` job rejects a `data/*.json` change with no `src/`/`scripts/` change (a hand-edit), and the `catalog-source-sync` test (in `test:provider-registry`) rejects the reverse — a `src/` change you forgot to regenerate — by re-deriving the source-controlled facts (provider connection config, hand-listed creator models + their `ownedBy`/`name`, provider overrides) and diffing them against the committed JSON. It's deterministic (no upstream fetch), so it only covers source-derived data; upstream-enriched fields (pricing, inferred metadata) and overall correctness still rely on the schema/catalog-invariant tests above and code review.
