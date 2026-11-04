# Agent Note: Bundle main-process JavaScript dependencies by default

Status: proposed

English | [中文](2026-11-03-main-dependency-bundling.zh.md)

## Problem

The main and utility-process builds externalize every package in `dependencies`. `electron.vite.config.ts` builds `mainExternalModules` from `Object.keys(pkg.dependencies)`, and electron-builder copies each external package into the app with its full install tree. Packages in `devDependencies` are bundled by Rolldown. Today 53 packages are in `dependencies`.

The bundler cannot trim a whole-package copy, so `electron-builder.yml` trims it by hand. The `files` list has about 24 rules naming specific packages. Some handle native payloads and are legitimate. Others remove unused JavaScript and assets, and these rules go stale silently:

- The two `js-tiktoken` rules, one of them under `@tavily/core`, target packages that are no longer installed.
- `pdf-parse/lib/pdf.js/{…}` targets the v1 layout. The project now uses pdf-parse 2.4.5, so the rule matches nothing, and a packaged build ships pdf-parse's CommonJS, browser and CLI builds plus pdfjs-dist's `build/`, `web/`, `image_decoders/` and `wasm/` directories. Counted on 2026-11-03, that is 95 files (about 14.6 MB uncompressed) that main never loads. A packaged build also carried about 4 MB of pdf-parse CJS builds that main never loads. The main chunk loads only the ESM entries through `import()`.
- Each dependency upgrade can add files, and nothing reports it.

Trimming by hand also has a failure mode no test catches. If a rule removes a file that runtime loads, development keeps working and only the packaged app fails. The comment at `electron.vite.config.ts:103` records the same failure mode for the split itself: moving the bundled Elysia stack into `dependencies` would make the packaged app fail with `MODULE_NOT_FOUND`, and no test catches it.

Comparable Electron apps keep very few packages external and let the bundler decide what ships. The counts below are from their default branches on 2026-11-03:

| Project | Runtime `dependencies` | How shipped files are chosen |
|---|---|---|
| LobeChat desktop | 9 | Vite bundles main; `files` starts with `!node_modules`, then adds native modules from a generated dependency closure |
| AFFiNE | 5 | esbuild `bundle: true` with 4 externals; `.node` files use the `copy` loader |
| Signal Desktop | 9 | Code ships in `bundles/**`; only those 9 package trees plus per-platform `.node` files ship |
| Chatbox | 2 | electron-builder's two-package.json layout; `release/app/package.json` lists only runtime packages |
| VS Code | 70 | Ships `node_modules` and trims it with a 278-line `build/.moduleignore` |

Cherry Studio is in the VS Code group without VS Code's reason, which is an extension host that loads arbitrary modules at runtime.

## Proposal

**Rule.** A package stays in `dependencies` only when at least one of these holds. Everything else moves to `devDependencies` and is bundled:

- **R1 Native.** It ships a `.node` addon or a platform executable, directly or through platform `optionalDependencies`.
- **R2 Package files at runtime.** It loads files from its own package directory by path, such as worker scripts, wasm or data files, and relocating those files would cost more than keeping the package.
- **R3 Own processes.** It spawns scripts or binaries shipped inside its package.
- **R4 Single instance.** It must share one module instance with a package that stays external, or it patches process-global state. Commit `21a2a672f7` is an example: `@vectorstores/env` has an import-once guard, and a bundled copy next to the external one throws at runtime.

A package that is a transitive dependency of a package kept by R1–R3 ships anyway. Moving it saves nothing and can create a second instance, so it falls under R4.

**Reason record.** Each package left in `dependencies` gets one entry with its rule and evidence, kept next to `mainExternalModules` in `electron.vite.config.ts` or in a small sibling module. A unit test fails when `dependencies` contains a package without an entry. This replaces trimming by hand with a positive list, which is the same idea as LobeChat's `nativeModules` list. The list holds about 25–30 reasons instead of patterns.

**Preliminary audit.** This is collected from package contents, source imports and dependency closures on 2026-11-03. Each implementation layer confirms the classification with a packaged run, and a package that fails to bundle stays with a recorded reason.

- Keep, R1: `@anthropic-ai/claude-agent-sdk`, `@cherrystudio/computer-use`, `@firecrawl/anydoc`, `@napi-rs/canvas`, `@napi-rs/system-ocr`, `@node-rs/xxhash`, `@paymoapp/electron-shutdown-handler`, `better-sqlite3`, `node-screenshots`, `onnxruntime-node`, `registry-js`, `selection-hook`, `sharp`, `sherpa-onnx-node`, `sqlite-vec`.
- Keep, R2 or R3: `@cherrystudio/system-speech` (wasm files), `@earendil-works/pi-coding-agent` (workers and child processes), `font-list` (spawns its own helpers; LobeChat keeps it external too), `tesseract.js` (loads its worker script by path).
- Keep, R4: `@earendil-works/pi-ai`, `quickjs-wasi` and `cross-spawn` (dependencies of `pi-coding-agent`), `onnxruntime-common` (shared with `onnxruntime-node`, which is patched), and `@vectorstores/core`, `@vectorstores/env` and `@vectorstores/readers` (import-once guard; they move together or not at all).
- Bundle candidates: `pdf-parse` and `pdfjs-dist` (main imports only `legacy/build/{pdf,pdf.worker}.mjs`; `cmaps/` and `standard_fonts/` move to `extraResources` and the `feature.pdfjs.*` path keys follow), `officeparser`, `turndown`, `jsdom`, `gray-matter`, `smol-toml`, `node-stream-zip`, `tar`, `@larksuiteoapi/node-sdk`, `grammy`, `ws`, `os-proxy-config`, `range-parser`, `@cherrystudio/remote-protocol`, `@cherrystudio/remote-transport`, `mediabunny`, `ts-ebml`, `opus-decoder`, `systeminformation`, `which`, `@cherrystudio/mlx-asr`, `@cherrystudio/mlx-tts`.
- Investigate: `@sentry/electron` (process-wide instrumentation), `graceful-fs` (patches `fs` globally; no direct import in the repo; added in `e3f061a54de`), `@huggingface/transformers` (utility-process only; reads package files and depends on `onnxruntime-node`), `ppu-paddle-ocr` (utility-process only; takes `onnxruntime-node` as a peer).

**Size signal.** These numbers are installed sizes before electron-builder filtering, so they are upper bounds, not packaged savings. The 246 packages reachable only from the bundle candidates take 82.8 MB on disk. The largest are `pdf-parse` with `pdfjs-dist` (26.0 MB), `@larksuiteoapi/node-sdk` (13.1 MB), `mediabunny` (9.5 MB), `turndown` (7.5 MB), `jsdom` (7.2 MB) and `@cherrystudio/remote-transport` (6.6 MB). The packaged baseline in AC5 is the real measure.

**Delivery.** This is a stack in which each layer can merge alone. Every layer moves one group, deletes the `electron-builder.yml` rules that only served the moved packages, and runs that group's features in a packaged build:

1. Reason record and its test, listing every current package (AC1). The packaged size baseline is recorded before any package moves (AC5).
2. Document parsing: `pdf-parse`, `pdfjs-dist`, `officeparser`, `turndown`, `jsdom`, `gray-matter`, `smol-toml`, `node-stream-zip`, `tar` (AC2, AC3).
3. Channels and network: `@larksuiteoapi/node-sdk`, `grammy`, `ws`, `os-proxy-config`, `range-parser`, `@cherrystudio/remote-protocol`, `@cherrystudio/remote-transport` (AC2).
4. Media and system: `mediabunny`, `ts-ebml`, `opus-decoder`, `systeminformation`, `which`, `@cherrystudio/mlx-asr`, `@cherrystudio/mlx-tts` (AC2).
5. The investigate group: each package either moves or gets a recorded reason. Then remove any remaining stale rules and report the final size (AC2, AC4, AC5, AC6).

Packages that main loads lazily today, after `9cda4031a0`, keep a dynamic `import()` after they move, so startup does not load them early.

## Alternatives considered

- Keep shipping whole packages and maintain more exclusion rules, as VS Code does with `.moduleignore`: rejected. Each upgrade can add unused files without any signal, and a rule that matches too much breaks only packaged builds.
- Adopt LobeChat's resolver: rejected for now. It starts `files` with `!node_modules`, computes the dependency closure itself, and copies pnpm symlinks into real directories in `beforePack`. electron-builder 26 already collects the pnpm production closure for this project, and the packaging log shows it doing so. LobeChat's version is about 330 lines and rewrites the local `node_modules` before packaging. Revisit only if the remaining packages still need trimming after this work.
- Chatbox's two-package.json layout: rejected. It adds a second install root and lockfile for native packages, and the existing dependencies split already produces the same result.
- Switching to Electron Forge or esbuild like AFFiNE: rejected. That migrates the packaging toolchain, which costs far more than this problem.
- Fixing only the pdf rules: rejected. It removes one symptom and keeps the mechanism that produced it.

## Acceptance criteria

- AC1 — Every package in `dependencies` has exactly one reason entry naming R1, R2, R3 or R4 with evidence, and a unit test fails when a package in `dependencies` has no entry or an entry names a package that is not in `dependencies`. (verification: unit)
- AC2 — For every package moved to `devDependencies`, a macOS arm64 packaged build runs the feature that imports it without `MODULE_NOT_FOUND` or a duplicate-instance error, and the layer's PR lists each feature path it ran. (verification: packaged artifact)
- AC3 — In a packaged build, PDF page count, text extraction and page rendering work, and file preview reads CMaps and standard fonts from `extraResources`, so a CID-keyed CJK PDF renders its text. (verification: packaged artifact)
- AC4 — `electron-builder.yml` contains no rule naming a package that is no longer shipped in `node_modules`, and `scripts/__tests__/package-contents.test.ts` asserts that the runtime files of the remaining trimmed packages are still included. (verification: unit)
- AC5 — `app.asar` plus `app.asar.unpacked` is measured for a macOS arm64 packaged build before the first package moves and after the final layer, both numbers are reported in the final PR, and the final size is not larger than the baseline. (verification: packaged artifact)
- AC6 — The dependencies-split comment in `electron.vite.config.ts` states the R1–R4 rule and points to the reason record instead of the API gateway README, which does not describe the split. (verification: docs gate)

## Risks

- Bundling can change runtime behavior in ways only the packaged app shows: duplicate module instances, file loads relative to `__dirname` or `import.meta.url`, and dynamic `require`. AC2's packaged runs are the control. A package that fails stays external with a recorded reason, so this costs savings, not correctness.
- Local verification covers macOS arm64. Windows and Linux packaging can differ in native resolution and path handling, and this plan does not verify them locally. Each layer's PR has to call this out, and the first release build after the stack needs a smoke test on both platforms.
- Moving packages makes the main bundle larger. A package that main loads lazily today must still be loaded with `import()` after it moves. Otherwise startup memory regresses, reversing `9cda4031a0`.
