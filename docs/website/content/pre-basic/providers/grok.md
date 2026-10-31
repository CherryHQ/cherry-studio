# Grok

Grok 是 xAI 推出的大模型，以"语气更随意 + 接入 X (Twitter) 实时数据"著称。

## 获取 API Key

* 前往 [xAI Console](https://console.x.ai/) 注册账号
* `API Keys` → `Create API Key`，复制 `xai-...` 密钥

## 在 Cherry Studio 配置

* 打开 `设置 → 模型服务`，找到 **Grok** Provider 进入详情页
* **API 密钥** 填入 `xai-...`
* **API 地址** 默认 `https://api.x.ai`，无需修改
* 点击 **获取模型列表**，添加 `grok-4`、`grok-4-fast` 等模型

## 推荐用法

| 模型 | 适合场景 |
|---|---|
| `grok-4` | 综合最强，复杂任务首选 |
| `grok-4-fast` | 高吞吐、低延迟场景 |
| `grok-3-mini` | 低成本日常对话 |

## 联网搜索

部分 Grok 模型自带联网能力，模型名后会显示小地球图标。可直接在对话框开启"联网"使用，详见 [联网模式](../websearch/)。

{% hint style="info" %}
* Grok 需海外网络访问，国内用户请配代理
* xAI 提供免费额度（按月刷新），日常体验足够
{% endhint %}

***

### 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
