# Registry compatibility baselines

Each `vN-validator.mjs` is a frozen, standalone bundle of the Zod schemas understood by the first
client for registry schema version N. CI validates every candidate catalog with the current version's
baseline before it can be published to `x-files/provider-registry/vN/`.

The v4 directory validator also freezes image-capability composition. It validates
creator/provider pairs across the two model files, not just each file's shape.
Image declarations are checked before tolerant catalog parsing, so malformed
image capabilities cannot pass publication by silently disappearing from a list.

The image contract uses a separate v4 publication stream with minimum application version
2.1.5. The already-published v1/v2/v3 validators remain unchanged; their version numbers
cannot be reused for the new contract.
The publisher leaves all pre-v4 directories untouched when publishing v4 or later;
the old tolerant validators would accept catalogs while silently dropping image entries.

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

A new runtime wire behavior that requires a higher `REGISTRY_MIN_APP_VERSION` also gets a new schema
stream and baseline, even if the JSON still parses. Older streams retain their published minimum
versions and can receive compatible updates only within the same contract generation;
raising the floor in place would cut them off. v4 is a structural boundary and is not
backfilled into v1/v2/v3.
