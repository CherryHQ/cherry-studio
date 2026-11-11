# Agent Note: 生成图片的动画契约

Status: implemented

[English](2026-11-09-generate-image-animation-contract.md) | 中文

## 问题

智能体传入帧数和帧时长，却没有选择 GIF。OpenAI 请求映射正确地省略了非 GIF 输出的时序参数，但工具接受了这组不完整的参数。实际生成的是单帧 PNG，智能体却宣称请求的八帧动画已成功生成。工具只返回文件名和 ID，没有提供实际产物的证据。

## 决策

公共绘图工具执行入口要求帧参数必须配合显式的 `outputFormat: gif`，否则在调用生图前拒绝请求。根据模型能力生成的参数描述会说明这一依赖。AI SDK 与 MCP 使用同一份校验；绘图页面清理残留参数的行为保持不变。

生成后，工具读取原始 FileEntry 字节，通过 Sharp 元数据报告检测到的格式、帧数和可用的帧延时。在现有文件数组中增加可选元数据和警告，兼容历史 `id`/`name` 结果。两个运行时使用相同的文本投影。GIF 请求的格式、帧数或显式时长未满足时，保留文件并附加警告，禁止自动重试付费请求。缺失或不可读的元数据保持未验证状态；取消仍然向上传播。

## 考虑过的替代方案

根据时序推断 GIF 会掩盖与显式格式的冲突。只加强工具描述无法强制执行依赖。在公共请求映射中拒绝时序会改变绘图页面独立的草稿清理行为。照抄请求元数据或信任扩展名会再次造成误报成功。该契约由工具拥有，无需改变 FileManager、AiService 或提供商目录。

## 影响

每个生成文件增加一次顺序读取和按需加载的 Sharp 元数据操作，不重新编码产物。元数据只能证明容器信息，不能证明可见动作、无缝循环或图片质量。读取或检查失败时保留生成文件，阻止宣称动画已验证。不增加存储迁移、提供商请求格式或自动重试。

## 验证

- Regression — `PaintingTool.test.ts` 在生图前拒绝此次缺失格式的输入，识别与 GIF 标签不符的 PNG 字节，报告真实 GIF 帧延时，保留未验证文件，并传播检查期间的取消。
- Regression — `cherryBuiltinTools.test.ts` 通过 MCP 连接检查相同的参数纠正反馈，报告实际 GIF 时序并保留原始内联字节。
- Regression — `MessageGenerateImage.test.tsx` 和 `markdownImageExport.test.ts` 同时接受历史结果及带检查元数据、警告的结果。
- Regression — `openaiImageRequest.test.ts` 和 `openaiImageSdkOptions.test.ts` 覆盖已安装适配器的 GIF 请求字段及未改变的非 GIF 时序过滤。
