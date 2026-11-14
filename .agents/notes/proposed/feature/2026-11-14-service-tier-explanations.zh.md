# Agent Note: 服务层级说明

Status: proposed

[English](2026-11-14-service-tier-explanations.md) | 中文

跟踪：CherryHQ/cherry-studio#20244

## Problem

`ModelSpeedControl`（`src/renderer/components/ModelSpeedControl.tsx` 中的 `supportsServiceTier` 区块）的服务层级单选组只显示 `agent.speed.service_tier.*` 的简短标签：Standard、Auto、Fast、Flex。用户无法判断每个层级改变了什么（延迟、费用、队列优先级、容量）、哪些模型支持它，以及所选层级不受支持时会发生什么。Issue 中的 “Elastic” 标签在当前 UI 中并不存在；本 Spec 以现有的四个层级为范围。

当前还有两个行为使问题更严重：

- `resolveSupportedServiceTier` 会悄悄把不受支持的选择替换为模型默认值。弹窗显示被替换后的值，却没有任何说明。
- 保存的选择与生效的选择可能不同，而 UI 不会说明这一点。

## Proposal

1. **通俗的层级文案。** 在渲染进程的语言目录中，为每个层级在 `agent.speed.service_tier.<tier>.description` 下添加一句简短描述。文案由 Cherry 自行撰写，不引用服务商的营销术语。每条描述用一句话说明实际的取舍，并指出它影响的维度（速度、费用、优先级或容量）。
2. **服务商术语保持独立。** 服务商特有的名称（例如 OpenAI 的 `priority` 或 `flex`）保留在注册表的 `values` 映射中，仅在用户展开详情时以“服务商值”的次要行显示，绝不作为主标签。
3. **由注册表决定可选项。** 只显示当前端点 `requestControls.serviceTier.options` 中声明的层级。模型未声明的层级不会列出，因此无法选中隐藏的层级。
4. **不受支持的选择直接禁用，而非强制替换。** 当保存的层级不在当前模型的选项中时，该单选项被禁用并附上说明（“此模型不支持，将使用 Standard”），旁边显示生效的层级。界面上以禁用状态取代静默回退。读取时不改写已保存的值。
5. **保存值与生效值保持可见。** 两者不同时，触发按钮和弹窗同时显示二者。
6. **安全默认值。** 默认值仍为 `standard`。本次变更不会把任何层级设为新的默认值。

超出范围：发送前的费用确认步骤、新增服务商层级（包括把 `flex` 作为新值）、以及请求管线的改动。请求管线已经会使用生效的层级。

## Alternatives considered

- **保持静默回退，并在别处说明。** 已否决：Issue 要求在使用处说明，而静默替换正是混淆的主要来源。
- **保存时再给出校验提示，而非禁用单选项。** 已考虑。它允许用户先选中不可能的组合，事后才修正。选定方案在选择前阻止，并说明原因。
- **在注册表中加入延迟、费用和容量数值。** 暂缓。服务商不公布可比较的数值，且注册表目前也没有这类字段（`packages/provider-registry/src/schemas/provider.ts`）。定性文案可避免编造数字。
- **用服务商术语作为标签。** 已否决：违反 Issue 中“保持服务商术语与 Cherry Studio 自身界面文案分开”的要求。

## Acceptance criteria

- AC1 — 每个显示的层级在 `en-us` 以及 `pnpm i18n:sync` 和翻译之后的所有语言目录中都有描述（verification: renderer）
- AC2 — 层级描述将速度、费用、优先级或容量之一作为主要取舍，且不把服务商营销术语用作标签（verification: renderer）
- AC3 — 只列出当前端点 `requestControls.serviceTier.options` 中声明的层级；未声明的层级从不渲染（verification: renderer）
- AC4 — 当前模型不支持的已保存层级渲染为禁用状态，附带说明和生效层级；读取时不覆盖已保存的值（verification: renderer）
- AC5 — 保存值与生效值不同时，触发按钮和弹窗同时显示二者；关闭后重新打开，显示的值保持一致（verification: renderer）
- AC6 — 对没有已保存层级的模型，默认选择保持为 `standard`（verification: unit）
- AC7 — 注册表中的服务商特定值只出现在次要详情行中，从不作为主标签（verification: renderer）

## Risks

- 服务商行为变化后文案可能过时。缓解：描述为通用取舍而非服务商承诺，并且每条只指明维度，不给数字。
- 对已保存的值禁用单选项，可能让在其他模型上设置过层级的用户感到意外。缓解：说明中写明回退结果，使变化可见而非静默。
- 译文可能落后于英文文案。缓解：`pnpm i18n:check` 会在合并前拒绝残留的占位符。
