# T-008C Chat 模型选择器迁 v2（方案 B 实施）

**关联 issue**：D-003C / 来自 [T-008 诊断](../T-008_ChatPickerV1V2Gap/诊断.md) + [T-008B 评估](../T-008_ChatPickerV1V2Gap/方案B评估.md)
**状态**：✅ **已完成 + 已验证** —— 代码完成 + 自动化 98/98 + 用户 fresh install 端到端手测通过（2026-05-21）
**记录日期**：2026-05-21
**实际工作量**：< 0.5 天

## 文件

- [任务.md](./任务.md) — brief：输入、约束
- [实施.md](./实施.md) — 改动清单 + 设计决策 + 校验记录
- [验证.md](./验证.md) — 自动化 + 浏览器手测期望现象

## 一句话产出

`chat-model-popup.tsx` 数据源从 **v1 Redux `useProviders` + `provider.models`** 换成 **v2 DataApi `useProviders` + `useModels`**，输出通过现成的 `toV1ProviderShim`/`toV1ModelShim` 转回 v1-shape；下游 0 改动；CHERRYAI Qwen demo 作为 fallback 注入（直到 v2 catalog 真有 cherryai user_model）。

## 已交付（vs T-008B 评估）

| 计划 | 实际 |
|---|---|
| chat-model-popup.tsx 改数据源 | ✅ |
| 复用 toV1ProviderShim / toV1ModelShim | ✅ |
| 保留 CHERRYAI_PROVIDER fallback（option A） | ✅ |
| 单元测试 ≥ 4 用例 | ✅ 6 用例 |
| 测试覆盖：Ollama 出现、CHERRYAI fallback 在/不在、hidden 排除、filter 生效 | ✅ |
| 业务代码下游 0 改动 | ✅ |
| 自动化全过 | ✅ format + oxlint + eslint + typecheck:web + vitest（12 文件 / 98 用例）+ i18n |

## 已知不在范围

- **手测**：Ollama 模型实际是否在 picker 里搜得到 / 选得中 / sendMessage 能正常发出 / Text Anchor Branch 能继续走 —— 等用户 `rm -rf ~/Library/Application Support/CherryStudioDev && pnpm dev`
- 老用户 v1 Redux 与 v2 user_model 之间的迁移（v2 阶段 v1 throwaway，fresh install 即正确）
- 删除 v1 Redux `state.llm.providers` selector（picker 是最后一个 v1 消费者之一，但 `useAssistant.model` 仍是 v1，独立 task）
- 把 qwenModel demo 写入 v2 catalog（独立数据 task；做了之后可删 fallback 5 行）
- `useDefaultModel`/`state.llm.defaultModel`/`assistant.model` 完整迁 v2（独立 task；做了之后可砍掉 toV1*Shim 调用）
