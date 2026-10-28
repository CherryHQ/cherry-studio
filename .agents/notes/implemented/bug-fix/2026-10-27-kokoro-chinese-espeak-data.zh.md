# Agent Note: Kokoro 本地朗读缺少所需的中文 eSpeak 数据

Status: implemented

[English](2026-10-27-kokoro-chinese-espeak-data.md) | 中文

## 问题

`kokoro-multi-lang-v1.1` 是 Kokoro v1.1-zh 模型。它的 sherpa-onnx 前端会把每次请求切分为汉字片段与非汉字片段：汉字片段查 `lexicon-zh.txt`，非汉字片段——包括中文回复里混入的英文单词和产品名——查 `lexicon-us-en.txt`，未收录的词则在该模型的 `en-us` 音色下回退到 eSpeak。

`src/main/ai/localModel/catalog/kokoro-v1.1.json` 只列了两个 eSpeak 语言文件：`lang/gmw/en` 与 `lang/gmw/en-US`。上游该版本提供 30 多个语系，`cmn_dict` 与 `sit` 语言文件从未被下载。该问题由 #22578 报告：选择中文后点击「试听」报「本地语音进程意外停止」，`inference.tts` 启动约两秒后以 code 1 退出，stderr 依次出现 `lexicon.cc:ConvertTokensToIds:93 Unknown token: ❓` 与 `Error processing file '/usr/share/espeak-ng-data\phontab': No such file or directory.`。重新下载永远无效，因为缺口就在下载清单本身。

崩溃路径位于内置的 espeak-ng，而不在元数据。词表未命中时的音素化使用 espeak 的当前音色；解析 `en-us` 需要编译期内置音色，内置音色需要 `espeak-ng-data/phontab`，而读取 `phontab` 需要 `espeak_ng_InitializePath` 接受传入的数据目录。它拒绝了我们的目录并回退到编译期的 `/usr/share/espeak-ng-data`；在那里 `phontab` 不可用，`espeak_ng_Initialize` 失败，`espeak_Initialize` 直接在 utility 进程里 `exit(1)`，而不是返回一个可被请求上报的错误。

## 决策

清单从同一不可变 revision 钉入前端所需的两个中文 eSpeak 文件：`espeak-ng-data/lang/sit/cmn`（`cmn` 音色）与 `espeak-ng-data/cmn_dict`（发音词典）。英文文件不变。缺失的 eSpeak 音色在设计上就是致命错误——`phoneme-ids.cc` 对任何无法解析的音色都会抛异常，因此缺少 `sit` 文件并不是「中文还能用」的情形。

`ModelBundle.files` 的两条性质现在被显式声明并受测试守护，而不再依赖约定：

- 顺序即安装顺序。catalog 为 Kokoro 显式排序——词典、中文 FST、tokens、eSpeak 数据，最后才是 `model.onnx` 与 `voices.bin`——而不再沿用 JSON 的字母序；在字母序里 `model.onnx` 排在了它所依赖的前端文件之前。下载与磁盘扫描走同一个列表，因此中断的下载现在会留下便宜的文件而缺失权重：状态明确为 `incomplete`，于是被当作可续传，而不是 `ready` 却没有可加载的内容。
- `parallelFetchFrom` 标出可独立下载的起点。Kokoro 的两份词典先一起下载，其余文件保持串行，避免数百 MB 的权重挡在使其可用的文件之前（或之后）。

worker 契约（传给 sherpa 的 `dataDir`、词典、规则 FST）未变。

## 备选方案

- 在 UI 中把 Kokoro 标注为仅支持英文：不作为本报告的修复。该模型是 Windows 与 Linux 上应用唯一的本地朗读路径，仍会正常翻译中文输入，而缺口是缺少词典，而不是不支持该语言。
- 下载上游完整的 `espeak-ng-data` 目录（30 多个语系、数十本词典、数 MB）：不采用，因为每个额外文件都是下载体积，也是另一份需要保持正确的校验产物。`en*` 加 `cmn`/`sit` 覆盖了 adapter 校验收的三种语言（`zh-CN`、`en-US`、`en-GB`），不支持的语言仍会显式失败，而不是静默读错。
- 不声明顺序地并发下载文件：不采用，因为进度、续传与「是否已安装」都读取同一个有序列表；任意并发会让一次被取消的 300MB 下载留下 `ready` 却缺词典的状态。
- 在运行时检测 `espeak_data_dir` 缺陷并让请求失败，而不是让进程退出：当前发布的 espeak-ng 构建无法做到，它在 `espeak_Initialize` 内部直接退出。把前端文件排在权重之前，才能保证不完整的安装不会走到那次调用。
- 升级 sherpa-onnx 或发布打过补丁的 espeak-ng：暂缓。1.13.8 运行时中 `espeak-ng-data` 的解析逻辑未变，而重建原生语音运行时是与「下载清单出错」不同的另一个决策。

## 后果

在所有该 bundle 支持的平台上，中文与中英混读的 Kokoro 朗读都能工作，中文回复里的第一个英文单词不再杀死 worker。bundle 增加两个文件（约 1.5MB）。Kokoro 下载现在先写词典、倒数第二个写 `model.onnx`，因此进度条在最大文件开始前已到约 40%，中断的下载也能从断点继续。

今后往 Kokoro bundle 里添加任何文件，都必须放进 `src/main/ai/localModel/catalog/catalog.ts` 的 `KOKORO_ORDER`；未列出的路径会在模块加载时抛错，而不是静默排到末尾。本文并不对 `/usr/share/espeak-ng-data` 回退的根因下断言：修复不再依赖哪一条路径最终接受了数据目录，但完整解释需要构建同一 espeak-ng 提交，本次改动未做。

## 验证

- 回归 — `pnpm test:main src/main/ai/localModel/catalog/__tests__/catalog.test.ts`：断言 Kokoro bundle 包含 `espeak-ng-data/lang/sit/cmn`、`espeak-ng-data/cmn_dict` 与 `espeak-ng-data/lang/gmw/en-US`；断言所有含权重的 bundle 都把 `model.onnx`/`voices.bin` 放在最后；断言 `parallelFetchFrom` 指向权重之前的独立文件。
- 回归 — `pnpm test:main src/main/ai/localModel/acquisition/__tests__/bundleDownload.test.ts`：断言被标记为独立的文件会并发下载，且在它们完成之前不会请求 `model.onnx`。
- 手动 — 本次改动没有可用的、带打包运行时的 Windows 机器；上文所述的 `espeak_ng_InitializePath` 拒绝行为是通过 sherpa-onnx 1.13.6 所钉的 espeak-ng 源码与 1.13.8 的 Windows 发布产物追踪得出，并未在 Electron utility 进程中复现。
