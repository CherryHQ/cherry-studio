# Agent Note: HEIF 聊天图像

Status: proposed

[English](2026-10-28-heif-chat-images.md) | 中文

## Problem

iPhone 的 HEIC/HEIF 照片在聊天预览和视觉发送前需要手动转换。Chromium 无法解码 HEVC，随应用分发的 sharp 构建也无法解码。仅添加扩展名会放行不可用的图像。

按 HEIF、HEIC、rendition 和被否决的存储方案检索活动笔记后，未发现现有决策所有者。这是一份新功能 Spec。维护者的单议题/单 PR 派工覆盖正常的独立 Spec PR 和实现堆叠布局，但不免除内容要求。A/B 部分在同一变更集中实现本提案。不声称获得独立 Spec 提交批准或对此精确修订的批准。在维护者审阅和剩余证据补齐前，保持 proposed。

## Proposal

保留原始身份、名称和字节。生命周期管理的 `src/main/services/HeifRenditionService.ts` 通过 `file.get_heif_rendition` 解析条目/路径句柄或字节；`src/main/utils/image.ts` 拥有字节变换。使用有界版本化文件读取，每次对实际字节计算哈希。无需派生 FileEntry、持久 PNG/缓存、临时文件、数据库结构或迁移。不增加远程 URL 获取或调用方指定限制。

解码主顶层图像，仅在未提供主图像时确定性地选择第一个顶层图像。输出完整分辨率 8 位 RGBA PNG，方向/镜像只应用一次并保留透明度。延迟加载 `libheif-js/libheif-wasm/libheif-bundle.mjs`，每次未命中缓存的转换创建新 WASM 实例。使用底层绑定，在 `finally` 中释放图像、句柄和上下文；将解码后的 RGBA 交给 sharp 原始输入 PNG 编码器，绝不传入 HEVC 字节。

| 边界                | 限制                                                                            |
| ------------------- | ------------------------------------------------------------------------------- |
| 编码输入 / PNG 输出 | 各 ≤ 67,108,864 字节（64 MiB）                                                  |
| 宽和高              | 正的安全整数，各 ≤ 16,384                                                       |
| 主图像像素          | ≤ 50,000,000；解码/分配前验证，并再次验证返回通道                               |
| 活动转换            | 1；底层转换结束前不释放槽位                                                     |
| 等待工作            | ≤ 8 个请求；等待输入保留量 ≤ 128 MiB                                            |
| 期限                | 从准入开始 30,000 ms，软期限                                                    |
| 编码结果 LRU        | `heif-png-v1:` + 实际字节的 SHA-256；≤ 16 项 / 64 MiB；TTL 300,000 ms；无负缓存 |

允许等于边界值。合并相同哈希的并发请求，移除失败的在途工作。取消一个消费者不得取消其他消费者需要的工作。渲染进程所有者各自创建/撤销 PNG Blob URL，并丢弃过时结果。关闭时拒绝待处理工作并清理保留状态。

| 界面                     | 契约                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 选择器/拖放/既有文件粘贴 | 放行 `.heic`/`.heif`，不区分大小写；保留模态门控                                                                                    |
| 编辑器令牌               | 可编辑/恢复/排队/只读悬停使用 PNG；激活保留面板优先与弹窗回退                                                                       |
| 已发送图像               | 单张/分组缩略图和灯箱使用 PNG，包括重载/编辑/重发                                                                                   |
| 文件预览                 | 桌面专用 HEIF 面板/标签页插件；可移植包有意保持不变                                                                                 |
| 文件页                   | 网格显示图标，通过 ImagePreviewService 打开；缩略图暂缓，因为无法显示原始 HEIF，且尚未定义网格呈现所有权                            |
| 视觉传输                 | 规范条目/文件 URL/声明为 HEIF 的内联输入转为临时 `image/png` 数据和 PNG 基础文件名；持久化原件不变；第一方 Claude Code 共享准备流程 |
| 非视觉                   | 在 OCR 前以本地化 HEIF 错误拒绝；建议转换 JPEG/PNG 或选择视觉模型；跨 OCR 后端规范化暂缓                                            |
| 外部/仅路径 Claude Code  | 保留现有路径回退；因绕过第一方准备，规范化暂缓                                                                                      |
| 远程 HEIF                | 获取/规范化不在此本地契约内                                                                                                         |

转换失败阻止发送，包括活动历史中的损坏 HEIF：必须移除/排除它，后续轮次才能继续。`HeifAttachmentError` 携带固定应用消息和本地化键，绝不携带原始解码诊断或路径。IPC 区分 `FILE_HEIF_INVALID`、`FILE_HEIF_UNAVAILABLE`、`FILE_HEIF_TOO_LARGE`、`FILE_HEIF_TIMEOUT`、`FILE_HEIF_BUSY`、`FILE_HEIF_READ_FAILED`；大小详情可指定 `input_bytes`、`dimensions`、`pixels`、`output_bytes`。中止保持中止语义，其他附件失败保留既有行为。

## Alternatives considered

- 持久派生 FileEntry：否决；增加身份、持久化、引用和清理所有权，而发送前预览仍需要解码。
- 仅发送时转换：作为主要接入点被否决；传输物化仍是消费者，但单独无法满足编辑器或历史显示。
- 渲染进程解码：否决；在窗口间重复所有权，后台/历史发送仍需要主进程解码。
- 工作线程/实用进程隔离：首轮暂缓；增加执行生命周期。出现已证实停顿/崩溃/内存增长或强制取消要求时重新评估；进程内存/崩溃隔离优先使用实用进程。

## Acceptance criteria

- AC1 — 受版本控制的 HEVC 输入以原始名称准入，在编辑器、已发送单张/分组图像、灯箱和桌面面板/标签页中显示，重载/编辑/重发后仍可用，所有者清理不破坏其他预览。 (verification: renderer + maintainer Electron)
- AC2 — 条目/文件 URL/内联数据及第一方 Claude Code 输出 PNG MIME/签名，传输中不含本地路径/内部 ID；存储原文件名与 SHA-256 不变。 (verification: main + maintainer Electron)
- AC3 — 损坏 HEIF 显示本地化转换建议，聊天请求为零；非视觉 HEIF 显示 OCR 限制，OCR/聊天请求均为零；普通 PNG 发送/OCR 保持完整。 (verification: main + maintainer Electron)
- AC4 — 限制、队列边界、大小/mtime 不变时的内容失效、失败重试、消费者取消和清理满足上述契约。 (verification: main + renderer)
- AC5 — 用代表性测试文件验证主图像与首图像、方向、镜像和透明度；Windows x64 打包应用解码内嵌模块并携带解码器声明/源代码/重建信息。 (verification: maintainer packaging + fixtures)
- AC6 — 代表性 12 MP/48 MP 照片计时和重复转换内存足以支持同进程执行；依赖配置验证冻结锁文件安装。 (verification: maintainer Windows x64 + CI)

## Risks

接受固定生产依赖 `libheif-js@1.23.5`（LGPL-3.0）、libheif 1.23.5 和 libde265 1.0.15（LGPL-3.0-or-later）、WASM 初始化成本、主进程同步解码和上述暂缓界面。`resources/licenses/heif/README.md` 列出源代码/构建引用、许可证哈希及重建/替换步骤；`electron-builder.yml` 将声明分发到 `licenses/heif`。配置不证明打包包含或加载成功。

30 秒期限为软期限：同步 WASM 可能阻塞主进程并超时；取消是协作式的。字节/像素/队列限制不是 RSS 上限。在 Windows x64 上普通 12 MP 照片可重复的主循环停顿超过 250 ms，或接受的 48 MP 照片超过一秒，出现可重现挂起/崩溃、已完成转换后内存持续增长，或需要硬期限/取消时，必须在合并前重新审查执行所有权。这些是阈值，不是已有测量结果。

## Verification

- AC1 — A/B 部分报告了定向 main/shared/renderer Vitest 证据。`tests/e2e/smoke/heifChatImages.test.ts` 已编写但未运行；维护者 Electron 证据待补充。
- AC2 — fileProcessor 和 ClaudeCodeRuntimeDriver 回归测试拥有规范化证据；冒烟测试捕获请求 JSON 并计算托管原文件哈希。运行时证据待补充。
- AC3 — attachmentRouting 回归测试断言 OCR 前拒绝。模拟聊天辅助工具不暴露 OCR 调用计数；运行时零 OCR 观察仍是缺口，不通过伪造后端旁路填补。
- AC4 — HeifRenditionService、image 和渲染进程生命周期测试拥有定向证据；套件通过本身不证明每个边界。
- AC5 — 合成 96×64 象限图为仓库原创图案，由 macOS sips 编码；测试文件 README 记录哈希/来源。它们不证明主图像选择、方向、镜像或透明度。代表性测试文件和打包加载待补充。
- AC6 — 代表性照片计时/内存、Windows x64 和冻结安装证据待补充。放大的纯色探针不足以证明。C 部分静态门禁结果记录在交接报告。
- Regression — 不扩展可移植预览、网格缩略图、普通图像 OCR 和外部 Claude Code。缺少运行时/打包证据，不能声明此 Spec 为 implemented。
