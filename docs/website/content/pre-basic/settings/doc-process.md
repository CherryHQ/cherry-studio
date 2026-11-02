---
icon: file-code
---

# 文档处理

简单说：**这是 Cherry Studio 把"PDF / 复杂版式文档"读成规整文本的中央配置。**

带表格、多栏、扫描页的 PDF（学术论文、合同、研报等）直接丢给模型往往会读得乱七八糟。文档处理会先用专门的解析引擎把它们转成结构清晰的文本，再交给对话或 [知识库](../../knowledge-base/knowledge-base.md) 使用。

{% hint style="info" %}
**文档处理 vs OCR**：两者是分开的两页设置。

* **文档处理**（本页）：管 **PDF / 复杂版式文档** 的结构化解析。
* **[OCR](ocr.md)**：管 **图片 / 扫描件** 里的文字识别。

普通纯文本 PDF、`.md`/`.txt`/`.docx` 里的文字段落两者都不需要，直接读即可。
{% endhint %}

### 配置入口

打开 【设置】→【文档处理】，右上角的下拉里选择解析引擎，**选中的引擎即作为默认**。

<figure><img src="../../assets/dbc7765b46b45fec4b345e04.webp" alt=""><figcaption><p>文档处理设置：① 右上角下拉选择解析引擎（默认 MinerU）；下方填入所选引擎的 API 密钥与 API 地址</p></figcaption></figure>

### 内置解析引擎

文档处理内置 6 个引擎，默认 **MinerU**：

| 引擎 | 说明 | 接入方式 |
| --- | --- | --- |
| **本地文档** | 内置本地解析，无需任何外部服务 | 无需配置 |
| **MinerU**（默认） | OpenDataLab 开源的高质量 PDF 提取工具 | API 密钥（[mineru.net/apiManage](https://mineru.net/apiManage)）|
| **PaddleOCR** | 百度飞桨 OCR 识别系统 | 填 API 密钥（[飞桨星河社区](https://aistudio.baidu.com/paddleocr/)）；如自部署则把 API 地址指向你的服务 |
| **Doc2x** | 高级文件还原引擎 | API 密钥（[open.noedgeai.com](https://open.noedgeai.com/apiKeys)）|
| **Mistral** | 文件解析与理解服务 | API 密钥（[mistral.ai](https://mistral.ai/api-keys)）|
| **Open MinerU** | 可自部署的 MinerU 服务，适合希望自行控制处理链路的团队 | 自部署后填 API 地址（按需填 API 密钥）|

### 配置 MinerU（默认方案）

{% stepper %}
{% step %}
### 填入 API 密钥

在【API 密钥】字段填入 MinerU 申请到的 key（点右侧「获取密钥」跳转申请页面，多个密钥可用逗号分隔）。
{% endstep %}

{% step %}
### 确认 API 地址

【API 地址】保持默认即可。
{% endstep %}

{% step %}
### 在知识库 / 对话中直接使用

导入复杂 PDF 时会自动走此处的解析设置，切换到知识库或对话时无需额外配置。
{% endstep %}
{% endstepper %}

{% hint style="info" %}
**换用其他引擎**：在下拉里选中它，填入该引擎的【API 密钥】/【API 地址】即可，选中即成为默认。其中 **PaddleOCR** 和 **Open MinerU** 支持自部署——部署后把【API 地址】填成你自己的服务地址。
{% endhint %}

### 与知识库的关系

* 文档处理仅负责"复杂文档 → 规整文本"这一步；
* 转换后的文本继续走 [嵌入模型](../../knowledge-base/emb-models-info.md) 向量化、入库；
* 详细的"在知识库中启用"流程见 [知识库文档预处理](../../knowledge-base/document-preprocessing.md)。

### 提示与技巧

* MinerU 对带表格 / 多栏排版的 PDF 效果显著更好，遇到学术论文等首选；
* 需要识别的是 **图片里的文字**（截图、扫描件）而非 PDF 结构，请改用 [OCR](ocr.md)。

***

### 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
