# DeepSeek

DeepSeek 是国内主流大模型厂商之一，以 V3 / R1 系列在编程与推理任务上有口皆碑，且价格亲民。

## 获取 API Key

* 前往 [DeepSeek Platform](https://platform.deepseek.com/) 注册账号
* `API Keys` → `创建 API Key`，复制 `sk-...` 密钥
* 充值任意金额（最低 ¥1 即可开通）

## 在 Cherry Studio 配置

* 打开 `设置 → 模型服务`，找到 **deepseek** Provider 进入详情页
* **API 密钥** 填入 `sk-...`
* **API 地址** 默认 `https://api.deepseek.com`，无需修改
* 点击 **获取模型列表**

## 推荐用法

| 模型 | 适合场景 |
| ------------------- | ---------------------------------- |
| `deepseek-chat` | 通用对话，性价比极高 |
| `deepseek-reasoner` | 数学、代码、复杂推理。注意输出会带 `<thinking>` 思考块 |

## 原生联网

DeepSeek 中支持联网能力的模型可以直接使用服务商原生网络搜索。选择模型时查看名称旁是否有 🌐 图标；具体支持范围可能随服务商更新，不建议只按模型名称判断。

在对话中打开 🌐 后，如果【设置】→【网络搜索】里的【优先使用模型内置的联网工具】保持关闭（默认），Cherry Studio 会优先使用已配置的搜索服务；开启该选项后，才会优先使用模型原生联网。详见 联网模式。

## 与全局记忆的搭配

DeepSeek 自家没有嵌入模型。如果你要用知识库：

* 嵌入模型推荐用其他 Provider 的（如 [硅基流动](siliconcloud.md) 的 `bge-m3` 或 [OpenAI](openai.md) 的 `text-embedding-3-small`）
* 对话模型仍可用 DeepSeek

{% hint style="info" %}
- DeepSeek 价格按 token 计费，缓存命中可大幅降价（参考其官方文档）
- `deepseek-reasoner` 的思考内容默认会渲染在对话中，可在 [对话设置](../../cherrystudio/preview/chat.md#dui-hua-she-zhi) 中切换"思考内容自动折叠"
{% endhint %}

***

### 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
