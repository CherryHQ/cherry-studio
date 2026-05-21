# T-007 Ollama Provider 自动模型同步失败诊断（D-003A）+ 修复（D-003B）

**关联 issue**：D-003
**状态**：🩺 D-003A 诊断 ✅；🔧 D-003B 修复 ✅ + 自动化 ✅ + 用户 fresh install Provider 设置页验证 ✅；⚠️ **Chat 弹窗仍未通 → 已剥离为 [T-008 D-003C](../T-008_ChatPickerV1V2Gap/) 单独跟进**
**记录日期**：2026-05-21

## 文件

- [任务.md](./任务.md) — brief：输入、约束、交付物
- [诊断.md](./诊断.md) — 调用链 + 根因 + 最小修复方案
- [验证.md](./验证.md) — 自动化结果 + fresh install 手动验证步骤 + 排查清单

## 一句话

Ollama 在 `packages/provider-registry/data/providers.json` 里**漏了 `defaultChatEndpoint` 字段**，又因为它的 endpointConfigs 含 `anthropic-messages` 键，主端点解析器（`getProviderHostTopology` 的优先级表）走到第三档命中 Anthropic → 整条链路把 Ollama 当 Anthropic 渲染、当 OpenAI 同步模型，最终 `/v1/models` 请求落到空 host → "Invalid JSON response"。

## 已实施修复（D-003B）

在 `packages/provider-registry/data/providers.json:425` 给 Ollama 加 **一行**（约定位置：`description` 与 `endpointConfigs` 之间，与其他 provider 对齐）：

```diff
   {
     "id": "ollama",
     "name": "Ollama",
     "description": "Ollama - AI model provider",
+    "defaultChatEndpoint": "ollama-chat",
     "endpointConfigs": {
       "ollama-chat": {
         "baseUrl": "http://localhost:11434"
       },
       "anthropic-messages": {
         "baseUrl": "http://localhost:11434"
       }
     },
     ...
   }
```

净 +1 行；只动 Ollama 一条；其他 provider 未触碰。详细验证步骤见 [诊断.md §5](./诊断.md)。

## 不在范围

- 是否同时移除 Ollama 的 `anthropic-messages` 入口（Ollama 0.5+ 的 Anthropic 兼容层是真实存在的；本次保留）
- 调整 `PRIMARY_CHAT_ENDPOINT_PRIORITY` 顺序（影响面更大，不必要）
- 修 `useProviderAutoModelSync` 的容错（根因在数据，不在 hook）
- 老用户 DB 行 `defaultChatEndpoint = NULL` 的迁移（v2 阶段 v1 数据可丢；新用户 fresh install 即正确，老用户走 `rm -rf ~/Library/Application\ Support/CherryStudioDev` 即可）
- 横向给 ovms / new-api / lmstudio / gpustack 补 `defaultChatEndpoint`（虽然也漏写，但因为它们恰好命中优先级表第 1 位 `openai-chat-completions` 没暴雷；cleanup 留作未来 task）
