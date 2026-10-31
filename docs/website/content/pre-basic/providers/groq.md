# Groq

Groq（注意：不是 xAI 的 Grok）是一个以 **LPU 硬件加速、超低延迟** 见长的推理服务，主要托管 Llama / Mixtral / Whisper 等开源模型，输出速度通常是普通云推理的几倍。

## 获取 API Key

* 前往 [GroqCloud](https://console.groq.com/) 注册账号
* `API Keys` → `Create API Key`，复制 `gsk_...` 密钥

## 在 Cherry Studio 配置

* 打开 `设置 → 模型服务`，找到 **Groq** Provider 进入详情页
* **API 密钥** 填入 `gsk_...`
* **API 地址** 默认 `https://api.groq.com/openai/v1`，无需修改
* 点击 **获取模型列表**

## 推荐用法

| 模型 | 适合场景 |
| ------------------------- | ---------- |
| `llama-3.3-70b-versatile` | 通用对话，速度极快 |
| `llama-3.1-8b-instant` | 简单任务，毫秒级响应 |
| `mixtral-8x7b-32768` | 长上下文 |
| `whisper-large-v3` | 语音转文字 |

## 适用场景

* **实时聊天机器人**：Groq 的"几乎瞬时响应"很适合 IM 接入（搭配 [频道](../../advanced-basic/automation/channels.md)）
* **大量并发**：每秒 token 数显著高于普通云推理
* **不在乎模型最新**：Groq 主要托管 Llama 系等开源模型，没有 GPT-5 / Claude-4 这种闭源模型

## 区分 Grok vs Groq

| | [Grok](grok.md) | Groq |
| -- | --------------- | --------------- |
| 公司 | xAI（马斯克） | Groq Inc. |
| 主打 | 自研大模型 + 联网 | LPU 硬件 + 开源模型推理 |
| 模型 | `grok-4` 等自研 | `llama-3.x` 等开源 |

{% hint style="warning" %}
Grok（xAI）和 Groq 经常被混淆。在 Cherry Studio Provider 列表中是两个独立条目，请注意区分。
{% endhint %}

***

### 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
