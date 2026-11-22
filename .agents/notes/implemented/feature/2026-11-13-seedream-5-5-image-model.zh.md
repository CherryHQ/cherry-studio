# Agent Note: Seedream 5.5 图像生成与透明素材

Status: implemented

[English](2026-11-13-seedream-5-5-image-model.md) | 中文

## 问题

缺少 Seedream 5.5 注册表条目时，用户只能退回通用 OpenAI 兼容图像提供商，并遇到 HTTP 400 响应。其单图请求契约与 Seedream 4.x 和 5.0 Lite 不同：不支持 `sequential_image_generation`、`stream` 和 `tools.web_search`，`n > 1` 会被忽略，仍只计一张图。透传旧组图控件并不安全；透传 `numImages` 还可能让 SDK 拆成多次付费请求。

## 决定

`src/shared/ai/seedreamImageContract.ts` 中的共享契约使用精确目标集合 `{ doubao-seedream-5-5 }`。它不匹配模型家族前缀：Lite 仍需要组图字段。ByteDance creator 和 Doubao 提供商声明该模型支持 generate/edit，两种模式均最多接收十张参考图。

注册表声明档位 `1K`、`1.5K`、`2K`（默认 `1K`）、与 `imageResolution` 配对的自定义尺寸、水印默认 `true`、背景默认 `auto`，以及默认 `jpeg` 的 JPEG/PNG 输出。显式正整数 `WxH` 尺寸与档位互斥。尺寸像素数须在 921600–4624220 之间（含端点），长短边比例不超过 16:1。共享校验器负责这些跨字段约束，不收紧全局 `buildParamsSchema`。

渲染层在提交 guard 和输入素材化之前检查参数，并在 `canonicalGenerate` 的通用校验之前再次检查。自定义尺寸转换成规范字段 `size`，绝不将 `WxH` 写入 `imageResolution`。透明素材预设原子设置 `background=transparent` 与 `outputFormat=png`，隐藏单独控件，并在编辑其他设置时保持这两个值。关闭时恢复 `background=auto`，保留 PNG 并解锁控件。这是渲染层预设，不是注册表操作模式。

`AiService.generateImage` 在权威闸门之前解析提供商/模型，用 `model.presetModelId ?? parseUniqueModelId(model.id).modelId` 确定目标身份。在 `splitParamValues`、图片归一化、SDK 分发或任务入队之前，它拒绝 DMXAPI 预设（包括用户创建的预设实例），校验尺寸及透明输出的兼容性，再清理参数集合。清理会移除 `numImages`、`sequentialImageGeneration`、`maxImages`、`webSearch`、`stream` 和 `tools`，合成尺寸并补齐默认值，不覆盖水印的 `false`。SDK 和任务交付均接收清理后的参数，默认生成一张图。失败沿用 `REMOTE_ERROR`，渲染层提供本地化消息，主进程提供可操作的消息。DMXAPI 的 5.5 协议尚未验证，其 transport 保持不变。

## 考虑过的替代方案

- 前缀匹配——也会移除 5.0 Lite 契约仍需要的组图参数。
- 新增注册表操作模式——透明背景和 PNG 是 generate/edit 内耦合的设置，不是独立操作。
- 全局收紧 `buildParamsSchema`——会改变无关模型，仍无法覆盖绕过渲染层的主进程直接调用者。
- 将 5.5 硬塞进 DMXAPI transport——会对未经验证的协议宣称兼容；明确拒绝可以保住该边界。
- 自定义错误码——现有 `REMOTE_ERROR` 和展示机制已能承载可操作的校验失败。

## 后果

DMXAPI 5.5 暂不可用。图层拆解与图层画布属于 stage 2。尚未实测真实厂商 PNG alpha；参数与请求体测试不能证明生成 PNG 的实际内容。

catalog 使用固定上游缓存快照生成。`result-5.md` 记录了生成时移除四条无关的陈旧 Gemini 约束索引成员；当前工作区保留这些成员，`server-tool-constraints.gen.ts` 没有差异。它们不属于最终交付的模型改动。该报告还指出，仅通过 schema-v4 兼容检查不能证明旧客户端理解配对自定义尺寸与跨字段校验；发布 catalog 需要适当的客户端版本决策。

## 验证

round-1 报告 `result-2b.md`、`result-3.md`、`result-4.md` 和 `result-5.md` 记录实现证据。`result-2b.md` 描述最初未完成的切片；后续报告补充渲染层、主进程和 catalog 证据。下列独立复跑计数由协调者提供，并非本次文档切片重新执行。

- AC1 — 共享测试：协调者复跑 25 项通过，覆盖精确目标身份、尺寸来源冲突、像素与比例限制、透明输出和参数清理。
- AC2 — 注册表测试：协调者复跑 71 项通过；`result-5.md` 验证 creator/catalog 一致、generate/edit、十张参考图及 5.5 不声明组图控件。
- AC3 — 渲染层测试：协调者复跑 70 项通过；`result-3.md` 记录提前拒绝、effective mode 尺寸投影、原子透明设置、排除 Lite 及 URL 参考图导入。
- AC4 — 主进程测试：协调者复跑 131 项通过；`result-4.md` 记录 SDK/任务参数清理、单次请求的请求体断言、DMXAPI 拒绝及非目标兼容性；当前代码先校验再清理，并按上文解析预设身份。
- AC5 — 协调者报告 compat、i18n、builtin-knowledge 和 change-scope 检查均退出 0；`result-5.md` 提供 catalog 兼容与生成证据，包括发布限制。
