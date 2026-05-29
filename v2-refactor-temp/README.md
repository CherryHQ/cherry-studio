# V2 Refactor Temp Directory

Working directory for the Cherry Studio v2 data and UI refactor. Holds shared tools, working notes, and other transient artifacts used during the refactor.

**Important**: This directory will be removed after the v2 refactor lands.

## Layout

```
v2-refactor-temp/
├── tools/                    # Refactor tooling
│   └── data-classify/        # Data classification and code generation
├── docs/                     # Working notes
│   ├── breaking-changes.md   # V2 breaking changes index
│   └── breaking-changes/     # Individual breaking change records
└── README.md                 # This file
```

## Contents

### Tools (`tools/`)

- **data-classify/** — Data classification and code generation pipeline
  - Extracts the data inventory from source
  - Manages classification mappings
  - Generates TypeScript types and migration mappings
  - See [tools/data-classify/README.md](./tools/data-classify/README.md)

### Docs (`docs/`)

- **breaking-changes.md** — Index of v2 user-perceivable breaking changes
  - Any removed capability, incompatible data shape, migration downgrade, or user-visible behavior change should add an individual document and update this index
  - See [docs/breaking-changes.md](./docs/breaking-changes.md)

- **breaking-changes/** — Log of v2 changes that affect how users use the app
  - PR authors drop an entry alongside their PR; the release manager aggregates and translates these into the Chinese user-facing release note at v2.0.0
  - See [docs/breaking-changes/README.md](./docs/breaking-changes/README.md)

## Usage notes

1. This directory contains no production code — it only supports the refactor
2. Generated code is written to the canonical project locations, not here
3. Do not store anything that needs to be preserved long-term

## Cleanup plan

After the v2 refactor lands, remove this directory entirely:

1. Confirm all tooling here is no longer needed
2. Move any documents worth keeping to their canonical locations
3. Delete the `v2-refactor-temp/` directory
4. Update `.gitignore` and any remaining references
