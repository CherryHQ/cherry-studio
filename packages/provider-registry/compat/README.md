# Registry compatibility baselines

Each `vN-validator.mjs` is a frozen, standalone bundle of the Zod schemas understood by the first
client for registry schema version N. CI validates every candidate catalog with the current version's
baseline before it can be published to `x-files/provider-registry/vN/`.

The v2 directory validator also freezes image-capability composition. It validates
creator/provider pairs across the two model files, not just each file's shape.

The validator files are immutable. If a catalog no longer validates, either keep the wire data
compatible or increment `REGISTRY_SCHEMA_VERSION` by one and create the next baseline:

```bash
pnpm --filter @cherrystudio/provider-registry compat:baseline
```

Never edit, regenerate, or delete an existing validator. A schema refactor that leaves the emitted
catalog compatible does not require a version bump.
