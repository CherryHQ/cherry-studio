# Agent Note: 主进程 JavaScript 依赖默认打进 bundle

Status: proposed

[English](2026-11-03-main-dependency-bundling.md) | 中文

## 问题

主进程和 utility process 的构建会把 `dependencies` 里的每个包都设为 external。`electron.vite.config.ts` 用 `Object.keys(pkg.dependencies)` 生成 `mainExternalModules`，electron-builder 再把每个 external 包连同它完整的安装目录复制进应用。`devDependencies` 里的包则由 Rolldown 打进 bundle。目前 `dependencies` 里有 53 个包。

打包工具没法裁剪原样复制进来的整个包，所以只能在 `electron-builder.yml` 里手动裁剪。`files` 列表里大约有 24 条点名具体包的规则。其中一部分处理 native 文件，是合理的；另一部分用来删掉用不到的 JavaScript 和资源文件，这类规则会在没人察觉的情况下失效：

- 两条 `js-tiktoken` 规则（其中一条在 `@tavily/core` 下面）针对的包已经不再安装。
- `pdf-parse/lib/pdf.js/{…}` 针对的是 v1 的目录结构。项目现在用的是 pdf-parse 2.4.5，这条规则什么都匹配不到，于是安装包里带上了 pdf-parse 的 CommonJS、浏览器和 CLI 版本，以及 pdfjs-dist 的 `build/`、`web/`、`image_decoders/` 和 `wasm/` 目录。2026-11-03 统计，这部分有 95 个文件（未压缩约 14.6 MB），主进程从来不会加载。实际打包出来的应用里还有约 4 MB 的 pdf-parse CJS 版本，主进程同样不会加载。主进程的代码只通过 `import()` 加载 ESM 入口。
- 每次升级依赖都可能多出新文件，而且没有任何提示。

手动裁剪还有一种测试抓不到的失败方式：如果某条规则删掉了运行时要加载的文件，开发环境照常运行，只有打包后的应用会出错。`electron.vite.config.ts:103` 的注释记录了依赖分界本身的同类问题：如果把已打进 bundle 的 Elysia 相关包挪到 `dependencies`，打包后的应用会在运行时报 `MODULE_NOT_FOUND`，而且没有测试能发现。

同类 Electron 应用只把很少的包设为 external，由打包工具决定哪些代码进安装包。下表数据来自它们 2026-11-03 的默认分支：

| 项目 | 运行时 `dependencies` 数量 | 怎么决定哪些文件进安装包 |
|---|---|---|
| LobeChat desktop | 9 | 用 Vite 打包主进程；`files` 先写 `!node_modules`，再按生成的依赖树加回 native 模块 |
| AFFiNE | 5 | esbuild `bundle: true`，只有 4 个 external；`.node` 文件用 `copy` loader |
| Signal Desktop | 9 | 代码打进 `bundles/**`；只带这 9 个包的依赖树，以及按平台挑选的 `.node` 文件 |
| Chatbox | 2 | electron-builder 的双 package.json 结构；`release/app/package.json` 只列运行时包 |
| VS Code | 70 | 原样打包 `node_modules`，再用 278 行的 `build/.moduleignore` 裁剪 |

Cherry Studio 和 VS Code 属于同一类，却没有 VS Code 的理由：VS Code 有一个会在运行时加载任意模块的插件宿主。

## 提议

**判断标准。** 一个包只有满足下面至少一条，才留在 `dependencies` 里；其余的都移到 `devDependencies`，由打包工具打进 bundle：

- **R1 Native。** 它自带 `.node` 插件或平台可执行文件，直接包含或通过平台专用的 `optionalDependencies` 提供。
- **R2 运行时读包内文件。** 它会按路径读取自己包目录里的文件，比如 worker 脚本、wasm 或数据文件，而且把这些文件单独搬出来比保留整个包代价更大。
- **R3 自带进程。** 它会启动自己包里的脚本或二进制文件。
- **R4 单一实例。** 它必须和某个保持 external 的包共用同一个模块实例，或者会修改进程级的全局状态。提交 `21a2a672f7` 就是一个例子：`@vectorstores/env` 有"只能 import 一次"的保护，bundle 里一份、external 一份，运行时就会抛错。

如果一个包是某个因 R1–R3 而保留的包的间接依赖，它无论如何都会进安装包。把它挪进 bundle 省不了任何体积，还可能多出一份实例，所以它归入 R4。

**理由记录。** 留在 `dependencies` 里的每个包都要有一条记录，写明它符合哪条规则以及证据。记录放在 `electron.vite.config.ts` 里 `mainExternalModules` 旁边，或者旁边单独一个小模块里。如果 `dependencies` 里有包没有对应记录，单元测试就会失败。这样就用一份"正向清单"取代了手动裁剪，思路和 LobeChat 的 `nativeModules` 列表一样。清单里大约是 25–30 条理由，而不是匹配规则。

**初步审查。** 以下结论基于 2026-11-03 对包内容、源码 import 关系和依赖树的统计。每一层实现都会用打包后的实际运行来确认分类；打进 bundle 后跑不通的包，就留在 `dependencies` 并记录原因。

- 保留，R1：`@anthropic-ai/claude-agent-sdk`、`@cherrystudio/computer-use`、`@firecrawl/anydoc`、`@napi-rs/canvas`、`@napi-rs/system-ocr`、`@node-rs/xxhash`、`@paymoapp/electron-shutdown-handler`、`better-sqlite3`、`node-screenshots`、`onnxruntime-node`、`registry-js`、`selection-hook`、`sharp`、`sherpa-onnx-node`、`sqlite-vec`。
- 保留，R2 或 R3：`@cherrystudio/system-speech`（wasm 文件）、`@earendil-works/pi-coding-agent`（worker 和子进程）、`font-list`（启动自带的辅助程序；LobeChat 同样把它保持为 external）、`tesseract.js`（按路径加载自己的 worker 脚本）。
- 保留，R4：`@earendil-works/pi-ai`、`quickjs-wasi` 和 `cross-spawn`（都是 `pi-coding-agent` 的依赖），`onnxruntime-common`（与打了补丁的 `onnxruntime-node` 共用），以及 `@vectorstores/core`、`@vectorstores/env` 和 `@vectorstores/readers`（有"只能 import 一次"的保护；要挪就一起挪，否则都不挪）。
- 可以打进 bundle：`pdf-parse` 和 `pdfjs-dist`（主进程只 import `legacy/build/{pdf,pdf.worker}.mjs`；`cmaps/` 和 `standard_fonts/` 改用 `extraResources` 打包，`feature.pdfjs.*` 路径随之调整）、`officeparser`、`turndown`、`jsdom`、`gray-matter`、`smol-toml`、`node-stream-zip`、`tar`、`@larksuiteoapi/node-sdk`、`grammy`、`ws`、`os-proxy-config`、`range-parser`、`@cherrystudio/remote-protocol`、`@cherrystudio/remote-transport`、`mediabunny`、`ts-ebml`、`opus-decoder`、`systeminformation`、`which`、`@cherrystudio/mlx-asr`、`@cherrystudio/mlx-tts`。
- 待调查：`@sentry/electron`（进程级的监控埋点）、`graceful-fs`（全局修改 `fs`；仓库里没有直接 import；在 `e3f061a54de` 中加入）、`@huggingface/transformers`（只在 utility process 中使用；会读包内文件，并依赖 `onnxruntime-node`）、`ppu-paddle-ocr`（只在 utility process 中使用；把 `onnxruntime-node` 作为 peer 依赖）。

**体积参考。** 以下是经过 electron-builder 过滤之前的安装体积，只能作为上限，不代表打包后实际能省多少。只被"可以打进 bundle"这一组用到的包共 246 个，占磁盘 82.8 MB。最大的几个是 `pdf-parse` 加 `pdfjs-dist`（26.0 MB）、`@larksuiteoapi/node-sdk`（13.1 MB）、`mediabunny`（9.5 MB）、`turndown`（7.5 MB）、`jsdom`（7.2 MB）和 `@cherrystudio/remote-transport`（6.6 MB）。实际效果以 AC5 的打包基线为准。

**交付方式。** 采用分层堆叠的 PR，每一层都能单独合并。每一层挪一组包，删掉只为这些包服务的 `electron-builder.yml` 规则，并在打包后的应用里实际运行这一组对应的功能：

1. 理由记录及其测试，列出当前所有的包（AC1）。在挪动任何包之前，先记录打包体积基线（AC5）。
2. 文档解析：`pdf-parse`、`pdfjs-dist`、`officeparser`、`turndown`、`jsdom`、`gray-matter`、`smol-toml`、`node-stream-zip`、`tar`（AC2、AC3）。
3. 渠道和网络：`@larksuiteoapi/node-sdk`、`grammy`、`ws`、`os-proxy-config`、`range-parser`、`@cherrystudio/remote-protocol`、`@cherrystudio/remote-transport`（AC2）。
4. 媒体和系统：`mediabunny`、`ts-ebml`、`opus-decoder`、`systeminformation`、`which`、`@cherrystudio/mlx-asr`、`@cherrystudio/mlx-tts`（AC2）。
5. 待调查的这一组：每个包要么挪走，要么记录保留原因。然后删掉剩下的失效规则，并报告最终体积（AC2、AC4、AC5、AC6）。

自 `9cda4031a0` 起由主进程延迟加载的包，挪动之后仍然通过动态 `import()` 加载，启动时不会提前载入。

## 备选方案

- 继续原样打包整个包，并维护更多的排除规则（VS Code 用 `.moduleignore` 就是这么做的）：不采用。每次升级都可能悄悄多出用不到的文件，而规则一旦匹配范围过大，只会在打包后的应用里出错。
- 照搬 LobeChat 的解析器：暂不采用。它在 `files` 开头写 `!node_modules`，自己计算依赖树，并在 `beforePack` 里把 pnpm 的软链接复制成真实目录。electron-builder 26 已经会为本项目收集 pnpm 的生产依赖树，打包日志里能看到这一点。LobeChat 的实现大约 330 行，而且打包前会改写本地的 `node_modules`。只有在这项工作完成后，剩下的包仍然需要裁剪时，再重新考虑。
- Chatbox 的双 package.json 结构：不采用。它要为 native 包多维护一个安装目录和一份 lockfile，而现有的依赖分界已经能达到同样的效果。
- 像 AFFiNE 那样改用 Electron Forge 或 esbuild：不采用。那等于迁移整套打包工具链，代价远超这个问题本身。
- 只修 pdf 相关的规则：不采用。这只消除了一个症状，产生问题的机制还在。

## 验收标准

- AC1 — `dependencies` 里的每个包都恰好有一条理由记录，写明 R1、R2、R3 或 R4 并附证据；当 `dependencies` 里有包没有记录，或者某条记录对应的包不在 `dependencies` 里时，单元测试失败。(verification: unit)
- AC2 — 对每个移到 `devDependencies` 的包，macOS arm64 打包后的应用能运行 import 它的功能，不出现 `MODULE_NOT_FOUND` 或重复实例的错误，并且该层的 PR 列出实际运行过的每条功能路径。(verification: packaged artifact)
- AC3 — 在打包后的应用里，PDF 取页数、提取文本和页面渲染都能正常工作；文件预览从 `extraResources` 读取 CMap 和标准字体，使用 CID 字体的中日韩 PDF 能正常显示文字。(verification: packaged artifact)
- AC4 — `electron-builder.yml` 里没有任何规则点名已经不在 `node_modules` 中打包的包，并且 `scripts/__tests__/package-contents.test.ts` 断言仍需裁剪的包的运行时文件依然会被打进安装包。(verification: unit)
- AC5 — 在挪动第一个包之前和最后一层完成之后，分别测量 macOS arm64 打包产物中 `app.asar` 加 `app.asar.unpacked` 的大小，在最后一层的 PR 中报告这两个数字，且最终大小不大于基线。(verification: packaged artifact)
- AC6 — `electron.vite.config.ts` 里关于依赖分界的注释写明 R1–R4 规则并指向理由记录，不再指向并未描述这一分界的 API gateway README。(verification: docs gate)

## 风险

- 打进 bundle 可能改变运行时行为，而且只有打包后的应用才会暴露：模块出现两份实例、按 `__dirname` 或 `import.meta.url` 相对路径读文件、动态 `require`。AC2 要求的打包实测就是对应的检查。跑不通的包会保持 external 并记录原因，所以代价只是少省一些体积，不会影响正确性。
- 本地验证只覆盖 macOS arm64。Windows 和 Linux 的打包在 native 模块解析和路径处理上可能不同，本方案不在本地验证它们。每一层的 PR 都要注明这一点，整个堆叠完成后的第一次正式版本构建，需要在这两个平台上做冒烟测试。
- 挪动包会让主进程 bundle 变大。今天由主进程延迟加载的包，挪动后必须仍然通过 `import()` 加载，否则启动内存会回退，相当于撤销了 `9cda4031a0` 的优化。
