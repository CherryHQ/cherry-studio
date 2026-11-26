# Agent Note: 无法识别的自定义模型的推理强度回退

Status: implemented

[English](2026-11-26-custom-model-reasoning-effort.md) | 中文

## 问题

手动添加的自定义模型，如果其 ID 没有命中任何 registry 推理家族规则，将完全得不到 reasoning 描述符：即使显式开启了 REASONING 能力，模型设置中也没有推理强度（Reasoning Effort）控件，请求也不会携带 effort 参数。唯一的例外是一个写死的 Ollama 回退分支，其他 Provider 上的自建或定制推理模型都无法调节推理强度。

## 决策

`inferCustomModelReasoning` 在模型显式声明 REASONING 能力但未命中任何家族规则时，合成 effort 控件 `[low, medium, high]`。已有的 wire 投影仍会对该档位做过滤：没有 effort 模式（或被禁用）的端点仍然解析为空，控件保持隐藏。`ModelService` 在创建与读取两条路径上保留 Ollama 更丰富的 `toggle + [low, medium, high]` 描述符，其关闭思考的能力不变。推导保持无状态：不新增任何持久化字段，`CreateModelDto`/`UpdateModelDto` 约定不变（intrinsic controls 仍归 catalog 所有，行数据只携带 `defaultEffort`）。

## 考虑过的替代方案

- 通过模型 DTO 持久化用户可编辑的 controls：否决。无状态回退已覆盖需求，没有必要扩大创建/更新契约；intrinsic controls 按设计归 catalog 所有。
- 为所有格式都加上 toggle（关闭开关）：否决。这与 gpt-oss、o1/o3/o4 等内置最小档位（只有 effort 档、没有关闭开关）不一致。
- 自定义档位值或参数名（issue 中的“更佳”期望）：延后。目前尚无对应的 UI 与 DTO 契约。

## 后果

自定义推理模型自动获得模型设置中的默认强度选择、composer 强度滑杆以及请求侧的 effort 编码。未声明 REASONING 能力的未知 ID 保持不变；被禁用的 wire 仍然隐藏控件。Ollama 自定义模型保留原有的 `none` 能力。

## 验证

- Regression — `pnpm vitest run src/main/data/services/__tests__/ModelService.test.ts src/main/data/services/__tests__/ProviderRegistryService.test.ts src/main/data/services/__tests__/modelMerger.test.ts`：189 通过，含 2 个新增 #25203 用例（未知 ID + 声明推理能力在创建与读取时回退为 `[low, medium, high]`；未声明时仍为 `reasoning == undefined`）。
- Regression — `pnpm --filter @cherrystudio/provider-registry test`：591 通过。
- Regression — `pnpm vitest run src/renderer/pages/settings/ProviderSettings/ModelList/ModelDrawer/__tests__/EditModelDrawer.test.tsx`：31 通过。
- Regression — `pnpm exec tsc --noEmit`：干净。
