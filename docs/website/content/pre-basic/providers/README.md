---
rich: true
icon: cloud-plus
---

# 模型服务配置

Cherry Studio 内置 60+ 家 Provider（模型服务商）的连接模板，覆盖国内外大部分主流模型与本地推理框架。本节汇总已有的服务商配置指南；查找其他服务商可先看[全部 Provider 快速参考](quick-reference.md)。

<div data-cards>
<div data-card>

[**查找服务商**](quick-reference.md)

从全部 Provider 快速参考进入对应配置指南。

</div>
<div data-card>

[**了解连接设置**](../settings/providers.md)

查看 API 密钥、API 地址与高级配置的说明。

</div>
</div>

### Provider 类型

Cherry Studio 把 Provider 按协议分为以下几类，行为略有差异：

| 类型 | 兼容协议 | 典型代表 |
|---|---|---|
| **OpenAI 兼容** | `/v1/chat/completions` | OpenAI、DeepSeek、硅基流动、OpenRouter、绝大多数三方网关 |
| **Anthropic 兼容** | `/v1/messages` | Anthropic、CherryIN、部分网关。**Cherry 智能体需要此类型** |
| **Gemini** | Google AI Studio / Vertex | Google Gemini、Vertex AI |
| **Bedrock** | AWS Bedrock SDK | AWS Bedrock |
| **Azure OpenAI** | Azure OpenAI Service | Azure OpenAI |
| **本地推理** | 本地 HTTP 服务 | Ollama、LM Studio、GPUStack、OpenVINO Model Server |
| **特殊网关** | 厂商私有协议 | NewAPI、OneAPI、AiHubMix、DMXAPI 等 |

### 添加一个 Provider 的通用步骤

{% stepper %}
{% step %}

#### 打开设置

打开 `设置 → 模型服务`

{% endstep %}
{% step %}

#### 选择服务商

在内置 Provider 列表中找到目标 Provider，点击进入详情页

{% endstep %}
{% step %}

#### 填写连接信息

填写 **API 密钥**（必填），按需修改 **API 地址**（默认是 Provider 官方地址）

{% endstep %}
{% step %}

#### 添加模型

点击 **获取模型列表**，按需添加你常用的对话/嵌入/视觉模型

{% endstep %}
{% step %}

#### 验证连接（可选）

（可选）点击 **检测**，用任一对话模型验证连接是否成功

{% endstep %}
{% endstepper %}

### Provider 配置详解

#### 通用/网关类
* [CherryAI (免费)](cherryai/)
* [CherryIN](cherryin-1.md) — 双端点（OpenAI + Anthropic），Cherry 智能体推荐
* [NewAPI](newapi.md) / [OneAPI](oneapi.md) — 自建/三方网关

#### 海外厂商
* [OpenAI](openai.md)
* [Anthropic (Claude)](anthropic.md)
* [Azure OpenAI](azure-openai.md)
* [Grok](grok.md)
* [Groq](groq.md)
* [OpenRouter](openrouter.md)
* [Google Gemini](google-gemini.md)
* [Vertex AI](vertex-ai.md)
* [Mistral](mistral.md)
* [Perplexity](perplexity.md)
* [GitHub Copilot](github-copilot.md)
* [MiniMax Coding Plan](minimax-coding-plan.md)

#### 国内厂商
* [DeepSeek](deepseek.md)
* [Moonshot AI (Kimi)](moonshot.md)
* [MiniMax](minimax.md)
* [阿里云百炼](a-li-yun-bai-lian.md)
* [智谱 ZhiPu](zhipu.md)
* [硅基流动](siliconcloud.md)
* [火山引擎（豆包）](doubao.md)
* [PPIO 派欧云](ppio.md)
* [ModelScope（魔搭）](modelscope.md)

#### 本地推理
* [Ollama](ollama.md)
* [LM Studio](lm-studio.md)

#### 自定义服务商
* [自定义服务商](zi-ding-yi-fu-wu-shang.md) — 任意 OpenAI / Anthropic / Gemini 兼容端点

{% hint style="info" %}
**没找到你用的 Provider 怎么办？**

先在[全部 Provider 快速参考](quick-reference.md)中查找。已有专题页的服务商可直接打开对应指南；未提供专题页的服务商，按本页通用步骤和[模型服务设置](../settings/providers.md)配置。使用兼容接口时，也可参考[自定义服务商](zi-ding-yi-fu-wu-shang.md)。
{% endhint %}

### API 密钥与 API 地址

详见 [模型服务设置](../settings/providers.md)（含 多 Key 轮询、`#` 结尾固定路径等高级用法）。

***

### 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
