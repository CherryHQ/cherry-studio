# @cherrystudio/provider-registry

## 0.2.5

### Patch Changes

- [#22575](https://github.com/CherryHQ/cherry-studio/pull/22575) [`ecef6a7`](https://github.com/CherryHQ/cherry-studio/commit/ecef6a7e32cc78a7976f99e1fbac6adee60b467e) Thanks [@ousugo](https://github.com/ousugo)! - Add Kimi K3.1 Pro and its highspeed variant with reasoning controls, fixed sampling constraints, and Moonshot pricing.

## 0.2.4

### Patch Changes

- [#22515](https://github.com/CherryHQ/cherry-studio/pull/22515) [`f740f7d`](https://github.com/CherryHQ/cherry-studio/commit/f740f7d65d130fb27e0ed6fcf6b62dd00e395811) Thanks [@cherry-coding](https://github.com/apps/cherry-coding)! - Add generate-mode quality and size presets for the GPT Image 2.5 Flare and Sunburst models.

## 0.2.3

### Patch Changes

- [#21999](https://github.com/CherryHQ/cherry-studio/pull/21999) [`5967cf3`](https://github.com/CherryHQ/cherry-studio/commit/5967cf357a4f619b6e01b4c21d8e0d024400989c) Thanks [@SaladDay](https://github.com/SaladDay)! - Rename MiniMax-M3.1-Flash-Preview to MiniMax-M3.1-Flash, preserve documented temperature support for MiniMax-M3 and MiniMax-M3.1-Flash, and refresh catalog content versions.

## 0.2.2

### Patch Changes

- [#21776](https://github.com/CherryHQ/cherry-studio/pull/21776) [`14d63eb`](https://github.com/CherryHQ/cherry-studio/commit/14d63eb93a65e0ea03df84722317bd9e6ec97404) Thanks [@ousugo](https://github.com/ousugo)! - Add Muse Spark Open BF16 and NVFP4 model recognition with multimodal capabilities and the official reasoning levels and default.

## 0.2.1

### Patch Changes

- [#21715](https://github.com/CherryHQ/cherry-studio/pull/21715) [`1b0c69f`](https://github.com/CherryHQ/cherry-studio/commit/1b0c69f9d9f086b3aaace631b187b427aac18aaf) Thanks [@1lck](https://github.com/1lck)! - Add widescreen, portrait, 16:10, and 4K size presets for GPT-Image-2 while preserving the existing sizes for GPT-Image-1 models.

## 0.2.0

### Minor Changes

- [#21675](https://github.com/CherryHQ/cherry-studio/pull/21675) [`a6e7c0f`](https://github.com/CherryHQ/cherry-studio/commit/a6e7c0fcdc0fe0f43e3c63702bf18cf56e72a5ae) Thanks [@WhiteZeek](https://github.com/WhiteZeek)! - Add optional billing URLs to provider website metadata and include billing destinations for OpenAI, Anthropic, CherryIN, and DeepSeek so applications can offer quota-recovery actions.

## 0.1.4

### Patch Changes

- [#19786](https://github.com/CherryHQ/cherry-studio/pull/19786) [`9ef4b13`](https://github.com/CherryHQ/cherry-studio/commit/9ef4b130f343dc4288dbf36dc49d32c35c7ddf15) Thanks [@kennyzheng-builds](https://github.com/kennyzheng-builds)! - Expose the Hugging Face router's Chat Completions endpoint alongside Anthropic Messages and Responses while preserving the default inherited by existing configurations.

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
