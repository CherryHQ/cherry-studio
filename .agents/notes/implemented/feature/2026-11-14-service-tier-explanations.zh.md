# Agent Note: 服务层级说明

Status: implemented

[English](2026-11-14-service-tier-explanations.md) | 中文

跟踪：CherryHQ/cherry-studio#20244

## Problem

`ModelSpeedControl`（`src/renderer/components/ModelSpeedControl.tsx` 中的 `supportsServiceTier` 区块）的服务层级单选组过去只显示 `agent.speed.service_tier.*` 的简短标签：Standard、Auto、Fast、Flex。用户无法判断每个层级改变了什么（延迟、费用、队列优先级、容量）、哪些模型支持它，以及所选层级不受支持时会发生什么。Issue 中的 “Elastic” 标签在 UI 中并不存在；范围是现有的四个层级。

当时还有两个行为使问题更严重：

- `resolveSupportedServiceTier` 会悄悄把不受支持的选择替换为模型默认值。弹窗显示被替换后的值，却没有任何说明。
- 保存的选择与生效的选择可能不同，而 UI 不会说明这一点。

## Decision

1. **通俗的层级文案。** 每个层级在渲染进程语言目录的 `agent.speed.service_tier.<tier>.description` 下携带一句简短描述。文案由 Cherry 自行撰写，不引用服务商的营销术语。每条描述用一句话说明实际的取舍，并指出它影响的维度（速度、费用、优先级或容量）。
2. **服务商术语保持独立。** 注册表的 `wire.values` 映射以只供展示的 `values` 映射形式投影到渲染进程模型的 `requestControls.serviceTier` 上（`ProviderRegistryService.projectServiceTierControl` 与 `ModelService`）。服务商特有的名称（例如 OpenAI 的 `priority`）仅在区块级“详情”开关展开后，以“服务商值”的次要行显示，绝不作为主标签。
3. **由注册表决定可选项。** 可选层级仅来自当前端点的 `requestControls.serviceTier.options`。唯一例外是不受支持的已保存层级：保留其单选项，但禁用且不可选择，并显示决策第 4 项中的说明。其他未声明的层级不会列出。
4. **不受支持的选择直接禁用，而非强制替换。** 当保存的层级不在当前模型的选项中时，该单选项被禁用并附上说明（“此模型不可用；正在使用 Standard”），说明中写明生效的层级。读取时不改写已保存的值；`resolveSupportedServiceTier` 仍是提交路径的强制收敛逻辑，保持不变。
5. **保存值与生效值保持可见。** 两者不同时，触发按钮和弹窗同时显示二者，形式为 `已保存 → 生效`。
6. **安全默认值。** 默认值仍为 `standard`。本次变更没有把任何层级设为新的默认值。

超出范围：发送前的费用确认步骤、新增服务商层级（包括把 `flex` 作为新值）、以及请求管线的改动。请求管线已经会使用生效的层级。

## Alternatives considered

- **保持静默回退，并在别处说明。** 已否决：Issue 要求在使用处说明，而静默替换正是混淆的主要来源。
- **保存时再给出校验提示，而非禁用单选项。** 已考虑。它允许用户先选中不可能的组合，事后才修正。选定方案在选择前阻止，并说明原因。
- **在注册表中加入延迟、费用和容量数值。** 暂缓。服务商不公布可比较的数值，且注册表目前也没有这类字段（`packages/provider-registry/src/schemas/provider.ts`）。定性文案可避免编造数字。
- **用服务商术语作为标签。** 已否决：违反 Issue 中“保持服务商术语与 Cherry Studio 自身界面文案分开”的要求。

## Consequences

弹窗中的服务层级行现在在每个标签下方渲染一行描述，因此该区块比以前更高。`Model.requestControls.serviceTier` 新增了只供展示的可选 `values` 映射；wire 的 `delivery` 细节仍不进入渲染进程。弹窗单选组的值改为保存的选择而非强制收敛后的值，因此已保存但不受支持的层级会显示为选中且禁用，直到用户改选受支持的层级。Composer 中提交时的收敛逻辑未改动，请求仍发送生效层级。描述是通用的取舍说明，服务商行为变化后可能过时；每条只指明维度，不给数字。对已保存的值禁用单选项，可能让在其他模型上设置过层级的用户感到意外；说明中写明回退结果，使变化可见而非静默。全部 17 个语言目录都携带新键；`pnpm i18n:check` 会在合并前拒绝残留的占位符。

## Verification

- AC1 — 已运行 `pnpm i18n:sync`，全部 17 个语言目录都携带翻译后的 `agent.speed.service_tier.<tier>.description`；没有残留 `[to be translated]` 占位符。
- AC2 — 每条描述说明其主要取舍，并指名速度、费用、优先级或容量之一；主标签仍是 `agent.speed.service_tier.<tier>` 中的共享层级名称。
- AC3 — `src/renderer/components/__tests__/ModelSpeedControl.ui.test.tsx`：只有已声明的层级渲染为可选单选项；不受支持的已保存层级只出现一次且禁用；未声明层级的情况下，渲染结果恰好是已声明选项加上已保存层级。
- AC4 — `ModelSpeedControl.ui.test.tsx`：在 `standard/fast/flex` 端点上保存的 `auto` 渲染为禁用，附带说明并写明生效层级，且单选组的值保持为已保存的 `auto`（已保存的值未被改写）。
- AC5 — `ModelSpeedControl.ui.test.tsx`：两者不同时，触发按钮显示 `已保存 → 生效`；弹窗每次渲染都从 props 推导二者，关闭后重新打开显示相同的值。
- AC6 — `ModelSpeedControl.ui.test.tsx`：对没有服务层级控件的模型，`resolveSupportedServiceTier` 返回 `standard`。
- AC7 — `ModelSpeedControl.ui.test.tsx` 与 `src/main/data/services/__tests__/ProviderRegistryService.test.ts`：投影暴露 `values` 而不暴露 `wire`；服务商术语仅在展开“详情”后渲染；单选主标签保持共享层级名称。
