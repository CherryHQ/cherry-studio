# Agent Note: 主进程 JavaScript 依赖默认打进 bundle

Status: implemented

[English](2026-11-03-main-dependency-bundling.md) | 中文

## 问题

主进程和 utility process 的构建会把 `dependencies` 和顶层 `optionalDependencies` 里的每个包都设为 external，electron-builder 再把每个 external 包连同它完整的安装目录复制进应用。`devDependencies` 里的包则由 Rolldown 打进 bundle。2026-11-03 时 `dependencies` 里有 53 个包，其中大部分是纯 JavaScript。

打包工具没法裁剪原样复制进来的整个包，所以只能在 `electron-builder.yml` 里手动裁剪，而这些规则会在没人察觉的情况下失效。pdf-parse 的规则针对的是 v1 的目录结构，实际什么都匹配不到，结果打包后的应用里带着 pdf-parse 的 CommonJS、浏览器和 CLI 构建，以及 pdfjs-dist 的 `build/`、`web/`、`image_decoders/` 和 `wasm/` 目录，而主进程从来不加载这些文件。还有些规则点名的包已经不再安装。如果某条规则删掉了运行时要加载的文件，只有打包后的应用会出错，没有测试能发现。

同类的 Electron 应用都只把很少的包设为 external，其余交给打包工具决定：LobeChat 桌面端保留 9 个，AFFiNE 5 个，Signal Desktop 9 个，Chatbox 2 个。VS Code 则把 `node_modules` 整个打进去，再用 278 行的 `build/.moduleignore` 裁剪，因为它的插件宿主会在运行时加载任意模块。Cherry Studio 用的是 VS Code 的打包方式，却没有 VS Code 的理由。

## 决定

**判断标准。** 一个包只有满足下面至少一条，才留在 `dependencies` 里；其余的都放在 `devDependencies`，由打包工具打进 bundle：

- **R1 Native。** 它自带或加载 `.node` 插件或平台可执行文件，直接包含或通过平台专用的 `optionalDependencies` 提供。
- **R2 运行时读包内文件。** 它会按路径读取自己包目录里的文件，比如 worker 脚本、preload 脚本、wasm 或数据文件，而且把这些文件单独搬出来比保留整个包代价更大。
- **R3 自带进程。** 它会启动自己包里的脚本或二进制文件。
- **R4 单一实例。** 它必须和某个保持 external 的包共用同一个模块实例，或者会修改进程级的全局状态。如果一个包作为某个因 R1–R3 而保留的包的依赖，无论如何都会进安装包，它也归入 R4，因为挪走它省不了任何体积。

这条规则写在 `CLAUDE.md` 的 "Main-Process Dependencies" 一节，`AGENTS.md` 也链接到这里；`electron.vite.config.ts` 里关于依赖分界的注释同样指向这一节。如果一个包是在运行时按名字解析的，比如通过 `createRequire(appPath).resolve(...)`，那么它根本不会经过打包工具，所以要留在 `dependencies`。

**留下的包及原因。** `dependencies` 里还剩 35 个包：

- R1：`@firecrawl/anydoc`、`@napi-rs/canvas`、`@napi-rs/system-ocr`、`@node-rs/xxhash`、`@paymoapp/electron-shutdown-handler`、`better-sqlite3`、`node-screenshots`、`onnxruntime-node` 和 `sherpa-onnx-node`（两者都通过打过补丁的 binding 路径加载下载来的插件）、`registry-js`、`selection-hook`、`sharp`、`sqlite-vec`，以及 `@cherrystudio/mlx-asr` 和 `@cherrystudio/mlx-tts`（napi-rs 加载器，推理入口在运行时从应用根目录解析它们）。
- R2：`@earendil-works/pi-coding-agent`（从自身位置解析 codemode worker 和 `quickjs-wasi/quickjs.wasm`）、`tesseract.js`（按路径启动 `worker-script/node/index.js`）、`jsdom`（它的 XMLHttpRequest 实现在加载时调用 `require.resolve('./xhr-sync-worker.js')`）、`@sentry/electron`（`preloadInjectionIntegration` 解析包内的 `preload/default.js`），以及 `@huggingface/transformers` 和 `ppu-paddle-ocr`（推理入口在运行时从应用根目录解析它们）。
- R3：`font-list`（执行它 darwin 入口旁边的 `fontlist` 二进制文件）。
- R4：`@earendil-works/pi-ai`、`quickjs-wasi`、`cross-spawn`、`ws` 和 `range-parser`（同样的版本本来就作为 `pi-coding-agent` 的依赖进安装包）；`onnxruntime-common`（与 `onnxruntime-node` 共用）；`@vectorstores/core`、`@vectorstores/env` 和 `@vectorstores/readers`（有"只能 import 一次"的保护）；`graceful-fs`（全局修改 `fs`，自 #8460 起保持 external）；`@cherrystudio/agent-runtime-pi`（它是 `pi-ai` 和 `pi-coding-agent` 的 ESM 入口，这两个包的 `exports` 只定义了 `import`；一旦打进 CommonJS 的主进程 bundle，它的 import 会变成 `require()`，并以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 失败）；以及 `@cherrystudio/agent-behavior`（主进程和 external 的 `agent-runtime-pi` 共用一个实例）。
- 构建限制：`ts-ebml`。它的 CommonJS 依赖树会把 Rolldown 的互操作运行时（`\0rolldown/runtime.js`）放进 `voice-audio.js` 这个 utility 入口，其他 utility 入口随之都去 import 这个入口，`utilityProcessEntryGuard` 因此让构建失败。

**打进 bundle 的包。** 已移到 `devDependencies`：`pdf-parse`、`pdfjs-dist`、`officeparser`、`turndown`、`gray-matter`、`smol-toml`、`node-stream-zip`、`tar`、`@larksuiteoapi/node-sdk`、`grammy`、`os-proxy-config`、`@cherrystudio/remote-protocol`、`@cherrystudio/remote-transport`、`mediabunny`、`opus-decoder`、`systeminformation`、`which`、`@cherrystudio/system-speech`、`@earendil-works/chord`、`@earendil-works/pi-durable`、`@anthropic-ai/claude-agent-sdk` 和 `@cherrystudio/computer-use`。原本用 `import()` 的调用点保持不变，这些库作为单独的懒加载 chunk 加载。

**包内数据。** pdf.js 的 CMap 和标准字体作为 `extraResources` 放在 `Resources/pdfjs/` 下；打包后 `feature.pdfjs.cmaps` 和 `feature.pdfjs.standard_fonts` 指向这里，开发环境指向 `node_modules/pdfjs-dist`。system-speech 的辅助程序和 Computer Use 运行时仍从 `packages/` 和 after-pack 打包，Claude Code 二进制仍走自己的下载路径，所以没有任何打进 bundle 的 SDK 会从自己包里查找原生文件。

## 考虑过的替代方案

- 理由记录：每个保留的包一条记录，再用单元测试强制检查。第一层实现过，后来在 #23527 的 review 中拿掉了。它在 `dependencies` 旁边多维护了一份清单，却不减少任何体积；这个决策改由 `CLAUDE.md` 的规则和本 note 承载。
- 继续把整个包打进去，再像 VS Code 的 `.moduleignore` 那样维护更多排除规则：否决。每次升级都可能悄悄多出无用文件，规则匹配过宽时又只会让打包后的应用出错。
- 采用 LobeChat 的解析器（`files` 以 `!node_modules` 开头，自行计算依赖闭包，并在 `beforePack` 中复制 pnpm 软链接）：否决。electron-builder 26 已经能为这个项目收集 pnpm 的生产依赖闭包。
- Chatbox 的双 package.json 结构，或者像 AFFiNE 那样换用 Electron Forge 或 esbuild：否决。两者都要增加安装根目录或迁移工具链，代价远大于这个问题本身。
- 用 `manualChunks` 或 `codeSplitting.groups` 给 Rolldown 的互操作运行时单独分一个 utility-process chunk：都不起作用，因为运行时模块根本不会进入这两个机制。`strictExecutionOrder: true` 确实能把它拆出来，但会重新包装全部 6 个 utility 入口里的每个模块，改动范围远大于让一个 2.5 MB 的包保持 external。
- 把 `jsdom` 打进 bundle，再把 `xhr-sync-worker.js` 复制到 chunk 旁边：否决，这是只为一个包写的打包粘合代码。

## 后果

- 在 macOS arm64 上用 `electron-builder --dir` 测量 `app.asar` 加 `app.asar.unpacked`：`c4c46c97ef` 上是 624.8 MB，最后一层是 570.1 MB。这两次构建之间 `main` 也有变化。每层相对下一层测得的节省分别是 27.1 MB（文档解析）、13.9 MB（渠道和远程访问）、9.7 MB（媒体和系统）和 8.8 MB（待调查组）。
- `electron-builder.yml` 不再点名任何不在生产依赖闭包里的包。删掉的有：失效的 pdf-parse 和 `js-tiktoken` 规则、`rollup-plugin-visualizer`、`node-pty` 和 `koffi` 的规则、针对 `node_modules` 里 system-speech 的裁剪，以及 Claude SDK 和 Computer Use 的平台包排除规则。那些平台包已经不在闭包里了。
- tesseract.js-core 的规则改为保留 `tesseract-core-simd-lstm`、排除 `tesseract-core-simd`。tesseract.js 默认使用 LSTM_ONLY 这个 OEM，只要支持 wasm SIMD 就会加载 `tesseract-core-simd-lstm`。自 #9631 起这个 core 一直被排除，打包后的 Tesseract OCR 加载 core 时会以 `MODULE_NOT_FOUND` 失败。
- 启动时加载的 `main.js` 增加约 665 KB，因为 `remote-transport`、libp2p 和 `os-proxy-config` 现在在它里面。它们本来就是启动时从 `node_modules` 加载的静态 import。
- `scripts/claudeCodeBinaryManifest.ts` 改为从 `devDependencies` 读取 Claude SDK 的版本。
- 本地验证只覆盖 macOS arm64。Windows 和 Linux 打包、Windows 上通过 `registry-js` 读取系统代理，以及 Windows x64 的 system-speech 辅助程序路径，需要在发版时到对应平台做冒烟测试。

## 验证

- AC1 — 在 #23527 的 review 中按决定被替代：理由记录及其单元测试实现过，之后被拿掉。这条规则改为写在 `CLAUDE.md` 的 "Main-Process Dependencies" 一节中作为指导，`pnpm docs:check` 保证这一节指向本 note 的链接有效。
- AC2 — 在 macOS arm64 打包产物上运行探针：用 `ELECTRON_RUN_AS_NODE=1` 运行发布的二进制，加载发布的 `app.asar` chunk，网络请求打到本地的假服务器。按 PR 列出结果：#23527 测了 pdf、officeparser、turndown、tar、gray-matter 和 node-stream-zip；#23530 测了飞书 HTTP、WebSocket 的 protobuf 帧、grammy、远程访问的 Noise 握手和系统代理；#23533 测了 `decodeWebm`、system-speech 的 `capabilities`、systeminformation 和 `which`；最后一层测了 Claude SDK 的 `query` 会启动指定的可执行文件，以及 Computer Use 的 `resolveRuntimePath`。最终安装包里，`out/main` 和 `out/utility-process` 的每个外部 `require` 都能解析，例外只有两类：`c4c46c97ef` 上本来就解析不了的可选 require，以及 systeminformation 有 try/catch 保护的温度传感器。
- AC3 — 打包产物上的探针通过 `pdf-parse` 和打进 bundle 的 pdfjs-dist 拿到了 PDF 页数、提取的文本和渲染出的页面。安装包里存在 `Resources/pdfjs/cmaps` 和 `Resources/pdfjs/standard_fonts`。`src/main/core/paths/__tests__/pathRegistry.test.ts` 要求每个打包后的 `feature.pdfjs.*` 路径都等于某个源目录存在的 `extraResources` 目标。在文件预览界面中渲染 CID 编码的 CJK PDF，这一步交给了发版 reviewer。
- AC4 — `scripts/__tests__/package-contents.test.ts` 的 "keeps the files each trimmed package loads at runtime" 会在剩余的裁剪规则删掉运行时入口文件时失败；它在旧的 tesseract 规则下确实失败了。剩余 `electron-builder.yml` 规则点名的每个包都在 `pnpm why --prod` 的依赖闭包里。
- AC5 — 挪动任何包之前，`c4c46c97ef` 上是 624.8 MB；最后一层之后是 570.1 MB；两者都用 macOS arm64 的 `electron-builder --dir` 测得。
- AC6 — `electron.vite.config.ts` 里关于依赖分界的注释写明了这条规则，并指向 `CLAUDE.md` 的 "Main-Process Dependencies"；`pnpm docs:check` 通过。
