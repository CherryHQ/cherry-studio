# Agent Note: 跨供应商消歧同一模型并在同模型切换供应商时保留绘画参数

Status: implemented

[English](2026-11-27-cross-provider-same-model.md) | 中文

## 问题

同一个模型由多个供应商提供时（例如 Gemini 与聚合商同时提供 `gemini-2.5-flash-image`），使用上有两处别扭。

第一，`ModelSelector` 的行无法区分：`useModelSelectorData` 按展示分组（默认每个供应商一组）计算重名，跨供应商的重名永远不会置位 `showIdentifier`；而非置顶行只渲染模型标识符——当 `apiModelId` 也相同时，标识符同样完全一样。

第二，在绘画页把同一 `apiModelId` 切换到另一个供应商会清空表单：`usePaintingModelSwitch` 把所有跨供应商切换都走 `createDefaultPainting`，把 `params` 重置为 `{}`，把 `mode` 强制改回 `generate`，并清空 `inputFiles`。

## 决策

`useModelSelectorData` 在全部可见模型上计算一份全局重名集合；名称出现多次的行都会置位 `showIdentifier`。`ModelRow` 对这类行一律渲染 `| {供应商名} · {模型标识}`，即使名称与标识都相同的行也能区分。同一供应商内的重名同样带上供应商前缀以保持一致。

`computeModelFieldReset` 接受 `oldProviderId`/`newProviderId`（旧的 `providerId` 参数仍然可用），并对两侧供应商的注册表块做差分；同一 `apiModelId` 换供应商不再直接返回空补丁。`usePaintingModelSwitch` 新增同 `apiModelId` 跨供应商分支：应用该差分、保留当前 `mode`，除非能确定目标模型不支持编辑，否则保留 `inputFiles`（从已确保加载的目录中解析，未知时默认保留）。切换到不同模型时仍做完整重置。

## 考虑过的替代方案

- 非置顶重名行只显示标识符：报告中的场景（两供应商 `apiModelId` 相同）仍会留下两行完全一样的条目。
- 所有行都显示供应商：常见的不重名场景会变吵；后缀只出现在确实重名的地方。
- 同模型跨供应商直接照搬 `params`：各供应商的注册表块可能不同，因此做差分与钳制，而不是原样复制。
- 目标模型未知时清空 `inputFiles`：会在报告的场景里继续误删附件，因此未知目标默认保留。

## 影响

所有 `ModelSelector` 调用方（对话、翻译、助手、设置、知识库、绘画）的跨供应商重名行都会带 `| 供应商 · 标识` 后缀。绘画页同模型换供应商时保留兼容参数、当前模式与附件，只有真正不兼容的值会被重置。按展示分组的重名集合已移除；合并后的供应商分组沿用全局行为。

## 验证

- Regression — `useModelSelectorData.test.ts` 对跨供应商同名与两供应商下同一模型 ID 置位 `showIdentifier`；同供应商内重名与唯一名称行为不变。
- Regression — `computeModelFieldReset.test.ts` 对跨供应商同模型做差分（拒绝的尺寸被钳制、兼容的保留），不再直接返回空。
- Regression — `usePaintingModelSwitch.test.ts` 在同模型换供应商时保留参数、模式与附件；目标为纯生成模型时清除附件；模型不同时仍完整重置。
- Regression — `ModelSelector.test.tsx`、presentation/scroll/DetailCard 套件、`PaintingModelSelector.test.tsx`、`PaintingPage.test.tsx` 与 `PaintingSettings.test.tsx` 保持通过。
