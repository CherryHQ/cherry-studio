# Agent Note: 保留 Ollama 原生思考档位

Status: implemented

[English](2026-10-23-ollama-native-thinking-levels.md) | 中文

## 问题

Ollama 通过 `/api/show` 声明模型特有的思考控制，但模型发现只读取上下文长度。目录补全和模型创建会丢失原生控制，现有 SDK 补丁还会拒绝 `xhigh`。Qwen3.8 27B 支持 `false`、`low`、`medium` 和 `xhigh`，通用的 `high` 不是等价设置。

## 决策

模型发现将支持的原生取值转换为模型固有的思考控制。模型创建和更新通过现有 reasoning JSON 列保留这些控制。原生 Ollama 的读取优先使用已保存的控制，再考虑目录推断；仅声明 `false` 的模型使用显式空控制。其他端点格式保留现有的目录优先级。

Ollama 预设默认使用 `ollama-chat`。即使服务商选择了其他默认端点，明确指定原生接口的模型也使用该端点投影思考配置。

获取模型操作通过模型批量 API 更新已有记录，仅改变思考元数据及其能力标记。缺少元数据不会清空已保存的控制。即使原生元数据当前与目录相同，也会保存下来。SDK 补丁接受布尔值或字符串形式的 `think`；应用封闭的思考取值集合决定哪些命名档位可供选择。

## 考虑过的替代方案

- 硬编码 Qwen 模型名称：别名和量化标签仍然依赖目录匹配。
- 用 `high` 替代 `xhigh`：Ollama 可能静默使用模型默认值。
- 删除并重新创建模型：现有模型身份和用户设置无需改变。

## 后果

用户通过获取 Ollama 模型刷新已有思考选项。无需数据库迁移或新增设置控件。不展示未知命名档位。服务商协议配置仍不写入模型持久化数据。

## 验证

- Regression — `listModels.test.ts`：即使标签中没有能力字段，原生元数据也能提供精确选项；覆盖纯布尔值、禁用和未知档位声明。
- Regression — `ModelService.test.ts`：自定义、可识别和预设记录在读取与更新时保留原生控制，并保留其他用户设置。
- Regression — `modelSync.test.ts` 和 `useProviderModelPullReconcile.test.ts`：目录补全和创建保留原生选项；缺少元数据和未变化的投影不会覆盖已保存的配置。
- Regression — `ollama.chatReasoning.test.ts`：SDK 的流式和非流式请求原样发送 `false`、`low`、`medium` 和 `xhigh`，默认选项省略 `think`。
- Regression — Electron 搭配 Ollama 0.34.3 和 `qwen3.8:27b`：获取模型会刷新已保存的控制并保留自定义上下文长度；界面选择发送各原生取值，默认选项省略参数；关闭思考时完成真实的 `OK` 回复。其他选项在抓取请求后取消。应用重启后，思考控制和自定义上下文长度仍然保留。
