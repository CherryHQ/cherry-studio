# NewAPI

Cherry Studio 已内置 New API 服务商。一个 New API 地址可以同时连接 OpenAI Chat、OpenAI Responses、Anthropic Messages 和 Gemini 协议，不需要为每种协议分别添加服务商。

## 配置步骤

1. 在 New API 管理后台创建并复制令牌；
2. 打开 Cherry Studio【设置】→【模型服务】→【New API】；
3. 填写【API 密钥】；
4. 在【API 地址】填写 New API 的根地址，例如 `https://api.example.com`；
5. 获取或手动添加模型，完成【检测】后打开右上角启用开关。

Cherry Studio 会按所选协议自动使用对应版本路径，例如 `/v1` 或 `/v1beta`。通常只需填写一次根地址，不要把 `/chat/completions` 等完整接口路径粘贴进去。

{% hint style="warning" %}
如果曾使用测试版，并在其他协议地址中保留了 `localhost:3000` 等旧值，请进入 New API 设置，把非默认协议的旧地址清空一次，再重新检测。否则部分模型可能仍请求旧地址。
{% endhint %}

<details>

<summary>中转站使用无版本路径怎么办？</summary>

只有当中转站明确要求使用不带 `/v1` 或 `/v1beta` 的路径时，才在对应 API 地址末尾加 `#`。`#` 表示不再自动拼接版本路径；普通 New API 部署不要使用。

</details>

{% hint style="info" %}
地址必须保留正确的 `http://` 或 `https://`。使用 IP 和端口时，可填写形如 `http://127.0.0.1:3000` 的根地址。
{% endhint %}

***

### 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
