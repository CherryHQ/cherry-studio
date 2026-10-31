# Azure OpenAI

Azure OpenAI 是微软在 Azure 上托管的 OpenAI 模型服务，适合需要企业合规、数据驻留承诺、或微软生态的团队。

## 前置准备

* 已开通 Azure 订阅
* 已在 Azure Portal 中申请并通过 Azure OpenAI Service 访问审批
* 已创建至少一个 **资源（Resource）** 与 **部署（Deployment）**

## 获取 API Key

* Azure Portal → 你的 Azure OpenAI 资源 → `Keys and Endpoint`
* 复制 `KEY 1` 或 `KEY 2`，记下 `Endpoint`（形如 `https://<your-name>.openai.azure.com/`）

## 在 Cherry Studio 配置

* 打开 `设置 → 模型服务`，找到 **Azure OpenAI** Provider 进入详情页
* **API 密钥**：填入复制的 KEY
* **API 地址**：填入资源的 Endpoint（无需带末尾路径）
* **API Version**：在专属字段填入你的部署的 API 版本（例如 `2024-08-01-preview`）
* 点击 **获取模型列表**，或手动添加你已在 Azure 上部署的模型名（即 Deployment Name，而非 OpenAI 原始模型 ID）

{% hint style="warning" %}
**Deployment Name vs Model ID**：Azure 用的是你给部署起的名字（如 `gpt-4o-prod`），不是 `gpt-4o` 这种原始 ID。填错会 404。
{% endhint %}

## 推荐用法

* **gpt-4o / gpt-4o-mini**：通用对话、智能体
* **gpt-4 turbo**：长上下文
* **text-embedding-3-**\*：嵌入模型，可用于知识库

## 常见问题

* **401 Unauthorized**：检查 Key 是否正确、Endpoint 末尾是否多余斜杠
* **404 Not Found**：检查 Deployment Name 是否与 Azure 上一致、API Version 是否填了
* **429 Throttled**：检查 Azure 配额（Quota & Limits 页）

***

### 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
