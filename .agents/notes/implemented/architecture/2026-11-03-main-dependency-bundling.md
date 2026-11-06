# Agent Note: Bundle main-process JavaScript dependencies by default

Status: implemented

English | [中文](2026-11-03-main-dependency-bundling.zh.md)

## Problem

The main and utility-process builds externalize every package in `dependencies` and in top-level `optionalDependencies`, and electron-builder copies each external package into the app with its full install tree. Packages in `devDependencies` are bundled by Rolldown. On 2026-11-03, 53 packages were in `dependencies`, and most of them were pure JavaScript.

The bundler cannot trim a whole-package copy, so `electron-builder.yml` trimmed it by hand, and those rules went stale silently. The pdf-parse rule targeted the v1 layout and matched nothing, so a packaged build carried pdf-parse's CommonJS, browser and CLI builds plus pdfjs-dist's `build/`, `web/`, `image_decoders/` and `wasm/` directories that main never loads. Other rules named packages that were no longer installed. A rule that removes a runtime file fails only in the packaged app, and no test catches it.

Comparable Electron apps keep few packages external and let the bundler decide what ships: LobeChat desktop keeps 9, AFFiNE 5, Signal Desktop 9 and Chatbox 2. VS Code ships `node_modules` and trims it with a 278-line `build/.moduleignore`, because its extension host loads arbitrary modules at runtime. Cherry Studio had VS Code's packaging without VS Code's reason.

## Decision

**Rule.** A package stays in `dependencies` only when at least one of these holds. Everything else goes in `devDependencies` and is bundled:

- **R1 Native.** It ships or loads a `.node` addon or a platform executable, directly or through platform `optionalDependencies`.
- **R2 Package files at runtime.** It loads files from its own package directory by path, such as worker scripts, preload scripts, wasm or data files, and relocating those files would cost more than keeping the package.
- **R3 Own processes.** It spawns scripts or binaries shipped inside its package.
- **R4 Single instance.** It must share one module instance with a package that stays external, or it patches process-global state. A package that ships anyway as a dependency of a package kept by R1–R3 also falls under R4, because moving it saves nothing.

The rule lives in the "Main-Process Dependencies" section of `CLAUDE.md`, which `AGENTS.md` links to, and the dependencies-split comment in `electron.vite.config.ts` points there. A package that is bundled but resolved by name at runtime, such as through `createRequire(appPath).resolve(...)`, is not bundled at all, so it stays in `dependencies`.

**What stays, and why.** 41 packages remain in `dependencies`:

- R1: `@firecrawl/anydoc`, `@napi-rs/canvas`, `@napi-rs/system-ocr`, `@node-rs/xxhash`, `@paymoapp/electron-shutdown-handler`, `better-sqlite3`, `node-screenshots`, `onnxruntime-node` and `sherpa-onnx-node` (both load a downloaded addon through a patched binding path), `registry-js`, `selection-hook`, `sharp`, `sqlite-vec`, and `@cherrystudio/mlx-asr` with `@cherrystudio/mlx-tts` (napi-rs loaders that the inference entries resolve from the app root at runtime).
- R2: `@earendil-works/pi-coding-agent` (resolves its codemode worker and `quickjs-wasi/quickjs.wasm` from its own location), `tesseract.js` (starts `worker-script/node/index.js` by path), `jsdom` (its XMLHttpRequest implementation calls `require.resolve('./xhr-sync-worker.js')` when it loads), `@sentry/electron` (`preloadInjectionIntegration` resolves `preload/default.js` inside the package), and `@huggingface/transformers` and `ppu-paddle-ocr` (the inference entries resolve them from the app root at runtime).
- R3: `font-list` (executes the `fontlist` binaries next to its darwin entry).
- R4: `@earendil-works/pi-ai`, `quickjs-wasi`, `cross-spawn`, `ws` and `range-parser` (the same versions ship as dependencies of `pi-coding-agent`); `onnxruntime-common` (shared with `onnxruntime-node`); `@vectorstores/core`, `@vectorstores/env` and `@vectorstores/readers` (import-once guard); `graceful-fs` (patches `fs` process-wide, kept external since #8460); `@cherrystudio/agent-runtime-pi` (the ESM boundary for `pi-ai` and `pi-coding-agent`, whose `exports` only define `import`; bundled into the CommonJS main build, its imports become `require()` calls that fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`); `@cherrystudio/agent-behavior` (one instance shared by main and the external runtime adapters); `ai` (the external runtime adapters load it through `@cherrystudio/agent-runtime`, so it ships anyway; main loads that same copy instead of bundling a second one) and `zod` (the peer `ai` and `@ai-sdk/provider-utils` load at runtime; without it the external `ai`, and with it every agent runtime adapter, fails to load in a packaged build); and `@cherrystudio/agent-runtime-pi-durable`, `@earendil-works/pi-durable`, `@earendil-works/chord` and `@earendil-works/pi-codemode` (the Pi Durable desktop integration keeps its ESM runtime and shared dependencies external).
- Build constraint: `ts-ebml`. Its CommonJS dependency tree puts Rolldown's interop runtime (`\0rolldown/runtime.js`) into the `voice-audio.js` utility entry, every other utility entry then imports that entry, and `utilityProcessEntryGuard` fails the build.

**Bundled.** Moved to `devDependencies`: `pdf-parse`, `pdfjs-dist`, `officeparser`, `turndown`, `gray-matter`, `smol-toml`, `node-stream-zip`, `tar`, `@larksuiteoapi/node-sdk`, `grammy`, `os-proxy-config`, `@cherrystudio/remote-protocol`, `@cherrystudio/remote-transport`, `mediabunny`, `opus-decoder`, `systeminformation`, `which`, `@cherrystudio/system-speech`, `@anthropic-ai/claude-agent-sdk` and `@cherrystudio/computer-use`. Call sites that used `import()` keep it, so those libraries load as separate lazy chunks.

**Package data.** pdf.js CMaps and standard fonts ship as `extraResources` under `Resources/pdfjs/`; `feature.pdfjs.cmaps` and `feature.pdfjs.standard_fonts` point there in packaged builds and at `node_modules/pdfjs-dist` in development. The system-speech helper and the Computer Use runtime keep shipping from `native/system-speech/` and through after-pack, and the Claude Code binary keeps its own download path, so no bundled SDK resolves a native payload from its package.

## Alternatives considered

- A reason record with one entry per kept package, enforced by a unit test: built in the first layer, then dropped in the #23527 review. It added a second list next to `dependencies` without reducing size; the `CLAUDE.md` rule and this note carry the decision instead.
- Keep shipping whole packages and maintain more exclusion rules, as VS Code does with `.moduleignore`: rejected. Each upgrade can add unused files without any signal, and a rule that matches too much breaks only packaged builds.
- Adopt LobeChat's resolver, which starts `files` with `!node_modules`, computes the dependency closure itself and copies pnpm symlinks in `beforePack`: rejected. electron-builder 26 already collects the pnpm production closure for this project.
- Chatbox's two-package.json layout, or switching to Electron Forge or esbuild like AFFiNE: rejected. Both add an install root or migrate the toolchain, which costs far more than this problem.
- `manualChunks` or `codeSplitting.groups` to give Rolldown's interop runtime its own utility-process chunk: neither applies, because the runtime module never reaches them. `strictExecutionOrder: true` does split it out, but it rewraps every module in all six utility entries, which is a much wider change than keeping one 2.5 MB package external.
- Bundling `jsdom` and copying `xhr-sync-worker.js` next to the chunk: rejected as custom packaging glue for one package.

## Consequences

- A macOS arm64 `electron-builder --dir` build measures `app.asar` plus `app.asar.unpacked` at 624.8 MB on `c4c46c97ef`. The final layer measured 570.1 MB before Pi Durable desktop integration; that size has not been remeasured with its runtime dependencies retained. `main` also changed between those builds. The per-layer savings, each measured against the layer below, are 27.1 MB (document parsing), 13.9 MB (channels and remote access), 9.7 MB (media and system) and 8.8 MB (the investigate group).
- `electron-builder.yml` no longer names a package that is not in the production dependency closure. Removed: the stale pdf-parse and `js-tiktoken` rules, `rollup-plugin-visualizer`, the `node-pty` and `koffi` rules, the system-speech `node_modules` trims, and the Claude SDK and Computer Use platform payload exclusions. Those payloads no longer enter the closure.
- The tesseract.js-core rules ship `tesseract-core-simd-lstm` and exclude `tesseract-core-simd`. tesseract.js defaults to the LSTM_ONLY OEM and loads `tesseract-core-simd-lstm` wherever wasm SIMD exists. Since #9631 that core had been excluded, so packaged Tesseract OCR failed to load its core with `MODULE_NOT_FOUND`.
- Startup `main.js` grows by about 665 KB, because `remote-transport`, libp2p and `os-proxy-config` are now inside it. They were already static imports loaded at startup from `node_modules`.
- `scripts/claudeCodeBinaryManifest.ts` reads the Claude SDK version from `devDependencies`.
- Local verification covers macOS arm64 only. Windows and Linux packaging, the Windows proxy lookup through `registry-js`, and the Windows x64 system-speech helper path need a release smoke test on those platforms.

## Verification

- AC1 — replaced by decision in the #23527 review: the reason record and its unit test were built and then dropped. The rule is enforced as written guidance in `CLAUDE.md` "Main-Process Dependencies", and `pnpm docs:check` keeps that section's link to this note valid.
- AC2 — macOS arm64 packaged-artifact probes, run with `ELECTRON_RUN_AS_NODE=1` on the shipped binary against the shipped `app.asar` chunks and with local stub servers. Results, by PR: #23527 pdf, officeparser, turndown, tar, gray-matter and node-stream-zip; #23530 Feishu HTTP and WebSocket protobuf frames, grammy, remote-access Noise handshake, and system proxy; #23533 `decodeWebm`, system-speech `capabilities`, systeminformation and `which`; the final layer Claude SDK `query` spawning the configured executable, and Computer Use `resolveRuntimePath`. Every external `require` in `out/main` and `out/utility-process` resolves in the final package, except the optional requires that already failed to resolve on `c4c46c97ef` and the guarded systeminformation temperature sensors.
- AC3 — the packaged probes return a PDF page count, extracted text, and a rendered page through `pdf-parse` and the bundled pdfjs-dist. `Resources/pdfjs/cmaps` and `Resources/pdfjs/standard_fonts` exist in the package. `src/main/core/paths/__tests__/pathRegistry.test.ts` requires each packaged `feature.pdfjs.*` path to equal an `extraResources` destination whose source exists. Rendering a CID-keyed CJK PDF in the file preview UI was handed to the release reviewer.
- AC4 — `scripts/__tests__/package-contents.test.ts` "keeps the files each trimmed package loads at runtime" fails when a remaining trim rule removes a runtime entry. It failed against the previous tesseract rule. Every package named by a remaining `electron-builder.yml` rule is in the `pnpm why --prod` closure.
- AC5 — 624.8 MB on `c4c46c97ef` before any package moved, and 570.1 MB after the final layer before Pi Durable desktop integration, both from macOS arm64 `electron-builder --dir`.
- AC6 — the dependencies-split comment in `electron.vite.config.ts` states the rule and points to `CLAUDE.md` "Main-Process Dependencies"; `pnpm docs:check` passes.
