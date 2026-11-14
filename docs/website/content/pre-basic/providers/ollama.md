# Ollama

Ollama 是一款优秀的开源工具，让您可以在本地轻松运行和管理各种大型语言模型（LLMs）。Cherry Studio 现已支持 Ollama 集成，让您可以在熟悉的界面中，直接与本地部署的 LLM 进行交互，无需依赖云端服务！

## 什么是 Ollama？

Ollama 是一个简化大型语言模型（LLM）部署和使用的工具。它具有以下特点：

* **本地运行：** 模型完全在您的本地计算机上运行，无需联网，保护您的隐私和数据安全。
* **简单易用：** 通过简单的命令行指令，即可下载、运行和管理各种 LLM。
* **模型丰富：** 支持 Llama 2、Deepseek、Mistral、Gemma 等多种流行的开源模型。
* **跨平台：** 支持 macOS、Windows 和 Linux 系统。
* **开放 API**：支持与 OpenAI 兼容的接口，可以和其他工具集成。

## 为什么要在 Cherry Studio 中使用 Ollama？

* **无需云服务：** 不再受限于云端 API 的配额和费用，尽情体验本地 LLM 的强大功能。
* **数据隐私：** 您的所有对话数据都保留在本地，无需担心隐私泄露。
* **离线可用：** 即使在没有网络连接的情况下，也能继续与 LLM 进行交互。
* **定制化：** 可以根据您的需求，选择和配置最适合您的 LLM。

## 在 Cherry Studio 中配置 Ollama

### **1. 安装和运行 Ollama**

首先，您需要在您的计算机上安装并运行 Ollama。请按照以下步骤操作：

* **下载 Ollama：** 访问 Ollama 官网（[https://ollama.com/](https://ollama.com/)），根据您的操作系统下载对应的安装包。\
    在 Linux 下，可直接运行命令安装 ollama：

    ```sh
    curl -fsSL https://ollama.com/install.sh | sh
    ```
* **安装 Ollama：** 按照安装程序的指引完成安装。
* **下载模型：** 打开终端（或命令提示符），使用 `ollama run` 命令下载您想要使用的模型。例如，要下载 Llama 2 模型，可以运行：

    ```sh
    ollama run llama3.2
    ```

    Ollama 会自动下载并运行该模型。
* **保持 Ollama 运行：** 在您使用 Cherry Studio 与 Ollama 模型交互期间，请确保 Ollama 保持运行状态。

### **2. 在 Cherry Studio 中添加 Ollama 服务商**

接下来，在 Cherry Studio 中添加 Ollama 作为自定义 AI 服务商：

* **打开设置：** 在 Cherry Studio 界面左侧导航栏中，点击“设置”（齿轮图标）。
* **进入模型服务：** 在设置页面中，选择“模型服务”选项卡。
* **添加提供商：** 点击列表中的 Ollama。

<figure><img src="../../assets/dafd5e68f0f3d7b350e22621.webp" alt=""><figcaption></figcaption></figure>

### **3. 配置 Ollama 服务商**

在服务商列表中找到刚刚添加的 Ollama，并进行详细配置：

1. **启用状态：**
   * 确保 Ollama 服务商最右侧的开关已打开，表示已启用。
2. **API 密钥：**
   * Ollama 默认 **不需要** API 密钥。您可以将此字段留空，或者填写任意内容。
3. **API 地址：**
   * 填写 Ollama 提供的本地 API 地址。通常情况下，地址为：

       ```
       http://localhost:11434/
       ```

       如果修改了端口，请自行更改。
4. **保持活跃时间：** 此选项是设置会话的保持时间，单位是分钟。如果在设定时间内没有新的对话，Cherry Studio 会自动断开与 Ollama 的连接，释放资源。
5. **模型管理：**
   * 点击“+ 添加”按钮，手动添加您在 Ollama 中已经下载的模型名称。
   * 比如您已经通过 `ollama run llama3.2` 下载了 `llama3.2` 模型, 那么此处可以填入 `llama3.2`
   * 点击“管理”按钮，可以对已添加的模型进行编辑或删除。

## 开始使用

完成以上配置后，您就可以在 Cherry Studio 的聊天界面中，选择 Ollama 服务商和您已下载的模型，开始与本地 LLM 进行对话了！

## 技巧与提示

* **首次运行模型：** 第一次运行某个模型时，Ollama 需要下载模型文件，可能需要较长时间，请耐心等待。
* **查看可用模型：** 在终端中运行 `ollama list` 命令，可以查看您已下载的 Ollama 模型列表。
* **硬件要求：** 运行大型语言模型需要一定的计算资源（CPU、内存、GPU），请确保您的计算机配置满足模型的要求。
* **Ollama 文档**: 可以点击配置页面中的 `查看Ollama文档和模型` 链接快速跳转至 Ollama 官网文档。

***

### 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
