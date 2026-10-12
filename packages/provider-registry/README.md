# @cherrystudio/provider-registry

Cross-platform AI provider and model catalogs, Zod schemas, and lookup utilities.
The core works without filesystem access, networking, timers, or application services.
Node file loading is available separately through `/node`.

## Installation

```bash
pnpm add @cherrystudio/provider-registry zod@^4.4.3
```

The first release is versioned as `0.1.0` through Changesets and uses the `latest` tag.
Zod is a peer dependency so applications can
compose the exported schemas with the same Zod installation.

## Bundled catalog

```typescript
import { createRegistry } from '@cherrystudio/provider-registry'
import { bundledCatalog } from '@cherrystudio/provider-registry/data'

const registry = createRegistry(bundledCatalog)
const provider = registry.findProvider('openai')
const model = registry.findModel('gpt-6.1-sol')
const override = registry.findOverride('cherryin', 'qwen/qwen3.5-9b')
```

The bundle contains all three validated catalogs and is usable offline, including
on first launch. Importing the core alone does not load any catalog JSON.

| Entry | Exports |
| --- | --- |
| `@cherrystudio/provider-registry` | `createRegistry`, `parseModelSnapshot`, schemas, types, enums, manifest contract and pure utilities |
| `@cherrystudio/provider-registry/data` | `bundledCatalog` |
| `@cherrystudio/provider-registry/data/providers` | `bundledProviders` |
| `@cherrystudio/provider-registry/data/models` | `bundledModels` |
| `@cherrystudio/provider-registry/data/provider-models` | `bundledProviderModels` |
| `@cherrystudio/provider-registry/node` | File readers, `RegistryLoader` and Desktop manifest compatibility policy |

Raw JSON is also exported as `/data/providers.json`, `/data/models.json`, and
`/data/provider-models.json`. Each file retains its content-hash `version`.
The JavaScript data entries avoid platform-specific JSON import syntax.

## Query contract

`createRegistry(catalog)` accepts a validated `RegistryCatalog`. Treat its input
records and returned records as read-only; the core does not deep-clone or freeze them.
Query lists are typed as read-only arrays.

| Method | Result |
| --- | --- |
| `listProviders()` | Trusted provider definitions |
| `listModels()` | Base models in this snapshot |
| `getOverridesForProvider(providerId)` | Provider-specific overrides, not a complete list of served models |
| `findProvider(providerId)` | Exact provider match, or `null` |
| `findModel(modelId)` | Exact model match, then size-preserving normalized fallback, or `null` |
| `findOverride(providerId, modelId)` | Exact canonical/API ID match before normalized fallback, or `null` |

A missing model size never falls back to another size. Canonical provider lookups
prefer the self variant when dated API variants coexist; each dated variant remains
addressable by its own API ID. Normalization only locates metadata: retain the API ID
returned by model discovery or explicitly supplied by the user when making requests.
A normalized catalog key is not a replacement request ID.

The existing `lookupRegistryModel()` convenience function uses the same matching
rules and resolves an API alias through its override's canonical model ID.

## Downloaded snapshots

Applications own download, validation against the manifest, persistence and activation.
Parse both model files before creating a replacement registry:

```typescript
import { createRegistry, parseModelSnapshot } from '@cherrystudio/provider-registry'
import { bundledProviders } from '@cherrystudio/provider-registry/data/providers'

const snapshot = parseModelSnapshot({
  models: JSON.parse(modelsText),
  providerModels: JSON.parse(providerModelsText)
})
const replacement = createRegistry({ ...snapshot, providers: bundledProviders })
```

`modelsText` and `providerModelsText` above are application-provided strings.
`parseModelSnapshot` validates their structure and applies the schemas' per-entry
forward compatibility. It does not check manifest hashes, runtime support, or freshness.
Invalid envelopes throw; incompatible entries and unknown list vocabulary are omitted
according to the shared schemas. Provider routing is not part of this input.

Before activation, the application must validate the manifest, both file versions,
and its runtime's supported semantics. Switch the complete snapshot together. An
application can start from bundled data, restore a compatible newer saved snapshot,
and check remote updates in the background. A failed update leaves the current view
usable. Creating a replacement registry does not mutate an existing registry.

Content hashes prove identity, not chronological order. Workflow revisions are only
comparable within their publication stream. Applications must retain source/schema
provenance when deciding whether saved or remote data supersedes a bundled snapshot;
this package does not invent an ordering from hashes or npm versions.

Unsigned remote data may update models and provider-model overrides, but must not
replace trusted provider connections, destinations, or credentials. Applications
continue to own custom providers, user overrides, product exclusions, and runtime
capability projection. Recognizing a reasoning dialect in the schema does not mean
that an application's Pi or AI SDK adapter can execute it.

## Node file loading

```typescript
import { createRequire } from 'node:module'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'

const require = createRequire(import.meta.url)
const loader = new RegistryLoader({
  models: require.resolve('@cherrystudio/provider-registry/data/models.json'),
  providers: require.resolve('@cherrystudio/provider-registry/data/providers.json'),
  providerModels: require.resolve('@cherrystudio/provider-registry/data/provider-models.json')
})

const model = loader.findModel('gpt-4o')
loader.invalidate()
```

The Node loader reads lazily, shares the portable lookup indexes, and releases cached
data after its idle timeout. `readModelRegistry`, `readProviderRegistry`, and
`readProviderModelRegistry` remain available for one-shot reads.

## Compatibility and platform boundaries

- Package versions describe the public JavaScript/TypeScript API.
- `REGISTRY_SCHEMA_VERSION` describes the remote JSON publication lane.
- `REGISTRY_MIN_APP_VERSION` is the Desktop semantic floor for that lane, not a
  Mobile application version or proof that another runtime supports every field.
- `CatalogManifestSchema` and file/schema constants are available from the core.
  The existing Desktop `isCatalogManifestCompatible(manifest, appVersion)` policy
  remains in `/node`; Mobile owns download admission and old-cache restoration.
- The root and data entries support ESM, CommonJS and React Native export conditions.
  They contain no Node filesystem or Electron imports. Actual Expo/device acceptance
  remains part of a consuming application's integration checks.

## Development

The three `data/*.json` files are generated. Edit `src/creators/` or `src/providers/`
and run the generator; never hand-edit catalog data. Contributor instructions and
architecture documentation live in this package's source repository.

From the monorepo root:

```bash
pnpm --filter @cherrystudio/provider-registry build
pnpm --filter @cherrystudio/provider-registry test:package
pnpm --filter @cherrystudio/provider-registry compat:check
```

`test:package` builds and installs a tarball outside the workspace, checks both module
formats and declarations, builds the portable surface for browsers, and exercises
React Native export resolution. It requires access to the npm registry.

Before publishing a new incompatible remote schema, increment `REGISTRY_SCHEMA_VERSION`
in `src/catalog.ts` by one and run `pnpm --filter @cherrystudio/provider-registry compat:baseline`.
Frozen baselines in `compat/` must not be rewritten. Runtime-semantic additions that
raise the Desktop version floor require a new stream; existing streams retain theirs.

## License

MIT. See [LICENSE](./LICENSE).
