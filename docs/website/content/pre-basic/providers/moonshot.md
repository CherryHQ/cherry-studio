# Moonshot AI (Kimi)

Moonshot AI 是国内知名大模型团队，主打产品是 **Kimi**，以 **超长上下文**（最长可达 200 万字）见长，适合塞大段文档 / 代码让 AI 帮你处理。

## 获取 API Key

* 前往 [Moonshot 开放平台](https://platform.moonshot.cn/) 注册账号
* 进入 `API Key 管理` 创建 `sk-...` 密钥
* 充值任意金额开通（最低很少）

## 在 Cherry Studio 配置

* 打开 `设置 → 模型服务`，找到 **Moonshot AI** Provider 进入详情页
* 填入 `sk-...` 密钥
* API 地址默认 `https://api.moonshot.cn`
* 点击 **获取模型列表**

## 推荐用法

| 模型 | 适合场景 |
|---|---|
| `moonshot-v1-8k` | 短上下文，便宜快速 |
| `moonshot-v1-32k` | 中等上下文，日常足够 |
| `moonshot-v1-128k` | 长上下文，文档分析、代码 review |
| `kimi-k2-* / k2.5-*` | 最新旗舰，推理能力更强 |

## 适合的场景

* **超长 PDF / 文档分析**：Moonshot 长上下文优势最明显
* **大段代码 review**：可以一次塞进完整文件不切分
* **整本电子书摘要**：长上下文模型省去手动切片麻烦

{% hint style="info" %}
* Moonshot 的"上下文缓存"功能可显著降低重复对话的 token 消耗，参考其官方文档
* Kimi 在网页端有自己的对话界面，但通过 Cherry Studio 接入 API 可以用上 Cherry Studio 的助手、知识库、MCP 工具等扩展能力
{% endhint %}

***

### 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
