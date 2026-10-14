# @cherrystudio/provider-registry

## 0.1.3

### Patch Changes

- [#21633](https://github.com/CherryHQ/cherry-studio/pull/21633) [`fda831e`](https://github.com/CherryHQ/cherry-studio/commit/fda831efece6a963c5cdb706cc84767dc1af66dc) Thanks [@DeJeune](https://github.com/DeJeune)! - Add Gemini Embedding 2 Preview, Nano Banana 2.1 and Pro alias metadata, and classify Gemini Omni 1.1 Flash as a video generation model.

## 0.1.2

### Patch Changes

- [#21625](https://github.com/CherryHQ/cherry-studio/pull/21625) [`7a7a424`](https://github.com/CherryHQ/cherry-studio/commit/7a7a4247185a8187e54bb09b77f407bd0c04981c) Thanks [@DeJeune](https://github.com/DeJeune)! - Support Gemini 4 Argon with the updated Google adapter and model catalog. Export context usage helpers that exclude repeated continuation prompts from context occupancy while preserving billed token counts, and allow catalog generation to refresh selected models.

## 0.1.1

### Patch Changes

- [#21547](https://github.com/CherryHQ/cherry-studio/pull/21547) [`cbc8088`](https://github.com/CherryHQ/cherry-studio/commit/cbc8088e51c060c83d129889230dadbed2fde545) Thanks [@pczhao1210](https://github.com/pczhao1210)! - Route New API image generation and editing through the New API adapter so gateway URLs receive the required API version prefix.

## 0.1.0

### Minor Changes

- [#21529](https://github.com/CherryHQ/cherry-studio/pull/21529) [`19309e5`](https://github.com/CherryHQ/cherry-studio/commit/19309e5bef1d89dc479344d844923fb5890eeaa8) Thanks [@DeJeune](https://github.com/DeJeune)! - Publish the cross-platform provider registry with optional bundled catalogs, public JSON exports, portable schemas and snapshot parsing, and shared size-preserving model and provider API ID lookup. Keep Node file loading available through the separate `/node` entry.
