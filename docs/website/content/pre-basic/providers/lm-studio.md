# LM Studio

LM Studio 是一款流行的 **本地大模型 GUI**，支持下载、量化并在本机推理各种开源模型。Cherry Studio 可作为前端连接到 LM Studio 的本地服务，在保留本地隐私的同时获得更好的对话体验。

## 前置准备

1. 从 [LM Studio 官网](https://lmstudio.ai/) 下载并安装客户端
2. 在 LM Studio 中下载至少一个模型（推荐先试 Llama 3.x 8B 或 Qwen 系列）
3. 打开 LM Studio 顶部 **Server** Tab，点击 **Start Server**（默认端口 `1234`）

## 在 Cherry Studio 配置

* 打开 `设置 → 模型服务`，找到 **LM Studio** Provider 进入详情页
* **API 地址** 默认 `http://localhost:1234`，如改过 LM Studio 端口请同步修改
* **API 密钥** 可留空（本地推理无需鉴权），或在 LM Studio 中开启鉴权后填入
* 点击 **获取模型列表**，Cherry Studio 会自动拉取 LM Studio 已加载的模型

{% hint style="info" %}
**模型列表为空？** LM Studio 只暴露 **已 `Load` 到内存** 的模型，没 Load 的不会出现在列表里。回到 LM Studio 先 Load 模型再来"获取模型列表"。
{% endhint %}

## 推荐用法

| 场景 | 建议 |
| -------------------- | --------------------------------------------------------------------- |
| 隐私敏感对话 | 选小模型（8B 以下）本机跑，完全离线 |
| Apple Silicon（M 系芯片） | LM Studio 用 MLX 后端，效率显著高于 llama.cpp |
| 嵌入模型 | LM Studio 也可加载嵌入模型，用于知识库 |

## 与 Ollama 的区别

| | LM Studio | [Ollama](ollama.md) |
| ---- | ------------- | ------------------- |
| 形态 | 图形界面 + Server | 命令行 / 后台服务 |
| 模型管理 | GUI 浏览/下载 | `ollama pull` |
| API | OpenAI 兼容 | OpenAI 兼容 |
| 适合 | 偏好图形交互的用户 | 偏好命令行 / Docker 部署 |

两者都可接入 Cherry Studio，按个人偏好选择即可。

## 常见问题

* **Cherry Studio 连不上**：确认 LM Studio 中 Server 是否已 Start（绿点状态）
* **响应巨慢**：模型过大 / 显存不足，换更小模型或更大量化（如 Q4 → Q3）
* **乱码 / 输出截断**：上下文长度超过模型限制，在 LM Studio 中调高 `n_ctx`

***

### 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
