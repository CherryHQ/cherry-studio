# GitHub Copilot

使用 GitHub Copilot 需要先拥有一个 GitHub 账号，并订阅 GitHub Copilot 服务，free 版本的订阅也可以，但 free 版本不支持最新的 Claude 3.7 模型，具体请参考 [GitHub Copilot 官网](https://github.com/features/copilot)。

## 获取 Device Code

点击「登录 GitHub」，获取 Device Code 并复制。

<figure><img src="../../assets/c55a91f9cdc6b88106e1d281.webp" alt="获取 Device Code 示例图片"><figcaption><p>获取 Device Code</p></figcaption></figure>

## 在浏览器中填写 Device Code 并授权

成功获取 Device Code 后，点击链接打开浏览器，在浏览器中登录 GitHub 账号，输入 Device Code 并授权。

<figure><img src="../../assets/1bf59331d4a2754ff20e7379.webp" alt="GitHub授权.png 示例图片"><figcaption><p>GitHub 授权</p></figcaption></figure>

授权成功后，返回 Cherry Studio，点击「连接 GitHub」，成功后会显示 GitHub 用户名和头像。

<figure><img src="../../assets/dd64cd1857b5e69446d98398.webp" alt="GitHub连接成功示例图片"><figcaption><p>GitHub 连接成功</p></figcaption></figure>

## 点击「管理」获取模型列表

点击下方的「管理」按钮，会自动联网获取当前支持的模型列表。

<figure><img src="../../assets/c0545b25325df32cd70fbad9.webp" alt="管理按钮获取模型列表示例图片"><figcaption><p>获取模型列表</p></figcaption></figure>

## 常见问题

### 获取 Device Code 失败，请重试

<figure><img src="../../assets/1fc3819d4c2caff7331c82bb.webp" alt="获取 Device Code 失败示例图片"><figcaption><p>获取 Device Code 失败</p></figcaption></figure>

目前使用 Axios 构建请求，Axios 不支持 socks 代理，请使用系统代理或 HTTP 代理，或者直接不在 CherryStudio 中设置代理，使用全局代理。首先请确保您的网络连接正常，以避免获取 Device Code 失败的情况。

***

### 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
