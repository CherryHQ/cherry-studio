# HEIF decoder notices and corresponding source

Cherry Studio uses the following libraries for HEIF/HEIC decoding. Their use is covered by the accompanying LGPL texts; the combined upstream notices also include GPL v3 and MIT texts. Library modification and reverse engineering for debugging such modifications are permitted under the applicable licences. No decoder sources are modified by Cherry Studio.

| Component | Version / source | Licence and copyright |
| --- | --- | --- |
| JavaScript distribution and embedded WASM wrapper | [libheif-js 1.23.5](https://github.com/catdad-experiments/libheif-js/tree/1.23.5), Kiril Vatev | LGPL-3.0 (package declaration); `libheif-js-LICENSE` |
| HEIF library and Emscripten bindings | [libheif 1.23.5, commit 413e2a87e6a70b3eccc3a3adc5801179dd2d9e00](https://github.com/strukturag/libheif/tree/413e2a87e6a70b3eccc3a3adc5801179dd2d9e00), Copyright (c) 2017-2025 Dirk Farin <dirk.farin@gmail.com>, struktur AG and contributors | LGPL-3.0-or-later; upstream combined LGPL/GPL/MIT notices in `libheif-wasm-LICENSE` and `libheif-js-library-LICENSE` |
| HEVC decoder | [libde265 1.0.15](https://github.com/strukturag/libde265/tree/v1.0.15), Copyright (c) 2013-2014 struktur AG, Dirk Farin and contributors | LGPL-3.0-or-later; `libde265-library-COPYING` and combined `libde265-COPYING` |

## Build provenance

The [libheif-js install script](https://github.com/catdad-experiments/libheif-js/blob/1.23.5/scripts/install.js) consumes the [libheif-emscripten v1.23.5 release](https://github.com/catdad-experiments/libheif-emscripten/releases/tag/v1.23.5). Its pinned libheif submodule is the commit above. The [build workflow](https://github.com/catdad-experiments/libheif-emscripten/blob/v1.23.5/.github/workflows/emscripten.yml) uses Emscripten 3.1.61, enables WASM and TypeScript and disables unsafe eval. The [pinned build script](https://github.com/strukturag/libheif/blob/413e2a87e6a70b3eccc3a3adc5801179dd2d9e00/build-emscripten.sh) defaults to libde265 1.0.15; AOM, OpenJPEG, WebCodecs and uncompressed decoding are disabled. This inventory follows those pinned build recipes, not an independent binary attestation. Cherry Studio loads `libheif-js/libheif-wasm/libheif-bundle.mjs`, whose WASM is embedded; sharp separately encodes its RGBA output as PNG.

## Rebuild and replacement

1. Obtain the libheif-emscripten v1.23.5 source with recursive submodules and retain the exact libheif commit above. Obtain libde265 v1.0.15 from its linked source or release archive. Preserve notices when modifying either library.
2. Follow the linked workflow in an Emscripten 3.1.61 environment: run libheif's `scripts/install-ci-linux.sh`, `scripts/prepare-ci.sh`, then the WASM variant of `scripts/run-ci.sh` with `USE_WASM=1 USE_UNSAFE_EVAL=0 USE_TYPESCRIPT=1`. Run `dist-prep.sh wasm` as in that workflow and arrange the resulting `libheif-wasm` directory into the upstream distribution archive.
3. Obtain libheif-js at tag `1.23.5`, provision its build dependencies, and run `node scripts/install.js /absolute/path/to/libheif.tar.gz` with that archive. This reproduces the wrapper and embedded bundle. Keep the exported factory and lower-level bindings interface-compatible with Cherry Studio's `src/main/utils/image.ts`.
4. In a Cherry Studio source checkout of the corresponding application release, replace the installed `libheif-js` package contents with the rebuilt distribution, retain these notices, and use the repository's documented build/package workflow. The explicit dependency import is externalized, so the replacement module is loaded at runtime rather than copied into the main JS bundle. Rebuilding the application avoids modifying a signed installation or relying on ASAR mutation. Users may modify/recombine these library portions and debug those modifications under the supplied licences.
5. Verify HEIF rendering in the rebuilt packaged app, including the embedded module import and decoding on the target platform. The source recipe and notices alone do not establish packaged loading or bit-for-bit reproducibility.

## Licence file integrity

`libheif-js-LICENSE`, `libheif-js-library-LICENSE` and `libheif-wasm-LICENSE` are verbatim copies from the installed `libheif-js@1.23.5` package (`LICENSE`, `libheif/LICENSE`, `libheif-wasm/LICENSE`). The package contains no separate libde265 licence file; the two codec texts were retrieved verbatim from `COPYING` and `libde265/COPYING` at the pinned libde265 tag above.

| File | SHA-256 |
| --- | --- |
| `libde265-COPYING` | `02cc1585a20677992e0ba578fa692635dc193735f2691dc81de924b51c4e8020` |
| `libde265-library-COPYING` | `da7eabb7bafdf7d3ae5e9f223aa5bdc1eece45ac569dc21b3b037520b4464768` |
| `libheif-js-LICENSE` | `e3a994d82e644b03a792a930f574002658412f62407f5fee083f2555c5f23118` |
| `libheif-js-library-LICENSE` | `fa81ce652315b013359d6e8e4744335f31a50c7c192907176d3632f78a3b4596` |
| `libheif-wasm-LICENSE` | `fa81ce652315b013359d6e8e4744335f31a50c7c192907176d3632f78a3b4596` |
