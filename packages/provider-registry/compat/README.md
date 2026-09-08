# Registry compatibility baselines

Each `vN-validator.mjs` is a frozen, standalone bundle of the Zod schemas understood by the first
client for registry schema version N. CI validates every candidate catalog with the current version's
baseline before it can be published to `x-files/provider-registry/vN/`.

The validator files are immutable. If a catalog no longer validates, either keep the wire data
compatible or increment `REGISTRY_SCHEMA_VERSION` by one and create the next baseline:

```bash
pnpm --filter @cherrystudio/provider-registry compat:baseline
```

Never edit, regenerate, or delete an existing validator. A schema refactor that leaves the emitted
catalog compatible does not require a version bump.

Since v2 the baselines are *forward compatible* (`src/schemas/forwardCompat.ts`): an unknown enum
member is dropped from its list, an unrecognizable entry is dropped from its catalog, and the
document still validates. So new vocabulary — a modality, a capability, a reasoning effort — is no
longer a wire break and must not bump the version. What still breaks a vN client is structural:
a renamed or retyped field, a removed required field.
