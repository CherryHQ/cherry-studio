# Agent Note: GPT Image 2.6 复杂度与动画生成

Status: proposed

[English](2026-11-05-openai-image-options.md) | 中文

## Problem

现有 GPT Image 2.6 集成能够生成、编辑静态图片，但没有场景复杂度和动画输出控件。单独升级 SDK 不会自动接通 Desktop 的参数和请求。

## Proposal

[PR #23678](https://github.com/CherryHQ/cherry-studio/pull/23678) 中独立审查的 SDK 维护是前置依赖，由 [Issue #23677](https://github.com/CherryHQ/cherry-studio/issues/23677) 跟踪。本 Spec 约束其上的 [PR #23684](https://github.com/CherryHQ/cherry-studio/pull/23684) Desktop 接入；AC1-AC2 记录必需的依赖验证证据。使用兼容 AI SDK 6 的 OpenAI 适配器 3.0.137，保留 Cherry 兼容补丁及 ai 6.0.185。

Sunburst 和 Flare 的生图、改图增加复杂度；生图增加 GIF 格式、帧数和每帧时长。OpenAI 当前接口文档已列出 GIF 改图，但目标 SDK 仍拒绝该格式，扩展上游改图适配器不在本次范围内。公共目录记录 API 能力，包括 GIF 改图及最高 655350 ms 的编码帧时长。Desktop 按各端点实际选择的适配器投影：OpenAI 3.0.137 将帧时长限制为 2000 ms，并隐藏 GIF 改图与时序控件；其他适配器保留各自契约。

中心参数目录拥有标准参数类型；OpenAI 映射使用 SDK 的驼峰选项名，再由 SDK 转为 HTTP 字段。表单依据编辑器当前参考图判断生图或改图，提交依据已物化的图片输入判断。remix、upscale、merge 等显式模式保留原语义。时序控件仅在 GIF 格式下显示、转发。绘图界面使用 GIF 自动帧尺寸，并隐藏静态图片尺寸：真实接口曾拒绝四帧 1024×1024 请求，原因是内部拼图超出尺寸上限。动画原始字节复用既有文件持久化、图片显示和导出链路。GIF 导出始终保存原始动画，包括预览旋转、翻转之后；这些预览操作仅改变显示。当参考图将生图草稿切换为仅支持静态输出的改图模式时，提交会去除残留的 GIF 格式及帧时序。

新增运行时语义使用目录 v4 发布流，保留冻结的 v3 发布流和验证器。计划最低 Desktop 版本为当前 2.1.10 之后的 2.1.11，发布前需与实际发布版本核对。

## Alternatives considered

SDK 7 会扩大迁移范围。自行序列化 HTTP 或增加下游 GIF 改图补丁会重复上游职责。将编辑器附件镜像到持久化草稿模式，会制造第二个事实来源。

## Acceptance criteria

- AC1 — 已安装 SDK 在生图、改图请求中发送复杂度；生图发送 GIF 格式和时序，非法 SDK 参数在 HTTP 前失败 (verification: unit)
- AC2 — 升级后保留聊天、Responses、工具调用和图片 URL 兼容补丁契约 (verification: unit)
- AC3 — 两款模型提供复杂度和 GIF 生图控件，加入参考图后隐藏仅生图可用的动画控件 (verification: renderer, Electron)
- AC4 — 标准参数以正确命名空间和 HTTP 字段抵达已安装 SDK，静态输出不携带残留 GIF 时序 (verification: unit)
- AC5 — 真实 GIF 生图返回动画，持久化、导出后帧时长和原始字节保持一致 (verification: Electron)
- AC6 — 仅两款目标模型发生语义变化，目录兼容、翻译和内置知识清单校验有效 (verification: unit, docs gate)

## Risks

OpenAI 指南和 API Reference 均规定 2–16 帧，而 SDK 3.0.137 允许 2–64 帧；目录遵循文档规定的 16 帧上限。SDK 将每帧时长限制为 20–2000 毫秒，本次暴露这一可执行子集。真实验证记录实际返回元数据。GIF 改图、SVG、markup 等能力延期。目录最低版本需与真正包含运行时改动的版本对应。

来源：[OpenAI 图片指南](https://developers.openai.com/api/docs/guides/image-generation)、[AI SDK 6 回移](https://github.com/vercel/ai/pull/24561)、[Images API Reference](https://developers.openai.com/api/reference/resources/images/methods/generate)。

独立发布器修复 [PR #23687](https://github.com/CherryHQ/cherry-studio/pull/23687) 已合并，通过移除未知图片参数键来保留旧版模型记录。它保留已知参数定义及选项值，因此 AC6 仍需验证旧客户端不会获得其已安装 SDK 不支持的 GIF 选项。冻结的旧验证器保持不变。现有实现继续保持草稿，等待本 Spec 当前提交获得 Approval，并完成发布兼容性验收。
