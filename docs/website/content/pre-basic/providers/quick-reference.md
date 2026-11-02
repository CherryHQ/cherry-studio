---
icon: list
---

# 全部 Provider 快速参考

Cherry Studio 内置 **60+ 家 Provider**，本页提供总览表，找到目标 Provider 后 **按指引填写密钥即可使用**。已有专题文档的 Provider 提供跳转链接，其余按通用步骤（[Provider 总览](README.md)）配置。

## 使用步骤

1. **查找目标 Provider**（可用 Ctrl/⌘+F 快速搜索）
2. 点击 **官网** 注册账号并获取 API Key
3. 在 Cherry Studio `设置 → 模型服务` 中找到对应 Provider，填写密钥后点击"获取模型列表"
4. 完成配置

## 一句话决策

| 你的需求 | 推荐方向 |
|---|---|
| **新手快速上手**，避免复杂流程 | [CherryIN](cherryin-1.md) 或 [CherryAI](cherryai/) |
| **国内访问最方便** | DeepSeek / Moonshot / 硅基流动 / 智谱 |
| **海外最强模型** | OpenAI / Anthropic / Gemini |
| **一个 key 通用 200 家** | [OpenRouter](openrouter.md) |
| **完全本地、隐私敏感** | [Ollama](ollama.md) / [LM Studio](lm-studio.md) |
| **企业合规** | [Azure OpenAI](azure-openai.md) / AWS Bedrock |
| **使用 [智能体](../../advanced-basic/agent.md)** | [Anthropic](anthropic.md) / [CherryIN](cherryin-1.md)（要支持 Anthropic 协议） |

## 国内大厂自营模型

无需翻墙、有中文优势、价格相对便宜。

| Provider | 一句话特点 | 官网 | 专题文档 |
|---|---|---|---|
| **DeepSeek** | 编程与推理性价比之王 | [deepseek.com](https://platform.deepseek.com/) | [→](deepseek.md) |
| **Moonshot AI (Kimi)** | 超长上下文（最长 200 万字） | [moonshot.cn](https://platform.moonshot.cn/) | [→](moonshot.md) |
| **ZhiPu (智谱)** | GLM 系列，多模态，兼容 Anthropic 可跑智能体 | [bigmodel.cn](https://open.bigmodel.cn/) | [→](zhipu.md) |
| **doubao (豆包/火山引擎)** | 字节出品，价格亲民 | [volcengine.com](https://www.volcengine.com/product/doubao) | [→](doubao.md) |
| **Baidu Cloud (文心一言)** | 百度 ERNIE 系列 | [cloud.baidu.com](https://cloud.baidu.com/) | — |
| **Bailian (阿里百炼)** | Qwen 系列、有海量模型 | [bailian.console.aliyun.com](https://bailian.console.aliyun.com/) | [→](a-li-yun-bai-lian.md) |
| **BAICHUAN AI** | 百川大模型 | [baichuan-ai.com](https://platform.baichuan-ai.com/) | — |
| **MiniMax** | 国内多模态（语音、视频） | [minimaxi.com](https://platform.minimaxi.com/) | [→](minimax.md) |
| **StepFun** | 阶跃星辰 | [stepfun.com](https://platform.stepfun.com/) | — |
| **LongCat** | 美团 LongCat 系列 | [longcat.chat](https://longcat.chat/) | — |
| **Xiaomi MiMo** | 小米大模型 | [mimo.mi.com](https://mimo.mi.com/) | — |

## 海外大厂自营模型

效果第一梯队，国内访问通常需要代理。

| Provider | 一句话特点 | 官网 | 专题文档 |
|---|---|---|---|
| **OpenAI** | GPT 系列 | [openai.com](https://platform.openai.com/) | [→](openai.md) |
| **Anthropic** | Claude 系列，智能体首选 | [anthropic.com](https://console.anthropic.com/) | [→](anthropic.md) |
| **Gemini (Google)** | Google 大模型 | [aistudio.google.com](https://aistudio.google.com/) | [→](google-gemini.md) |
| **Azure OpenAI** | 微软托管的 OpenAI，企业合规 | [portal.azure.com](https://portal.azure.com/) | [→](azure-openai.md) |
| **VertexAI** | Google Cloud 托管 | [cloud.google.com](https://cloud.google.com/vertex-ai) | [→](vertex-ai.md) |
| **AWS Bedrock** | 亚马逊托管多家模型 | [aws.amazon.com/bedrock](https://aws.amazon.com/bedrock/) | — |
| **Mistral** | 欧洲开源模型代表 | [mistral.ai](https://console.mistral.ai/) | [→](mistral.md) |
| **Grok (xAI)** | 马斯克 xAI，自带联网 | [x.ai](https://console.x.ai/) | [→](grok.md) |
| **Perplexity** | 搜索增强对话 | [perplexity.ai](https://www.perplexity.ai/) | [→](perplexity.md) |

## 网关 / 聚合

一个 key 接入多家模型，账号集中管理。

| Provider | 一句话特点 | 官网 | 专题文档 |
|---|---|---|---|
| **CherryAI** | Cherry 官方免费体验 | — | [→](cherryai/) |
| **CherryIN** | Cherry 官方付费网关，双端点（OpenAI + Anthropic）| [open.cherryin.cc](https://open.cherryin.cc/) | [→](cherryin-1.md) |
| **OpenRouter** | 海外最大聚合，200+ 模型 | [openrouter.ai](https://openrouter.ai/) | [→](openrouter.md) |
| **AiHubMix** | 海外聚合 | [aihubmix.com](https://aihubmix.com/) | — |
| **DMXAPI** | 国内聚合 | [dmxapi.cn](https://dmxapi.cn/) | — |
| **302.AI** | 国内聚合 | [302.ai](https://302.ai/) | — |
| **NewAPI** | 自建网关（开源） | [newapi.pro](https://docs.newapi.pro/) | [→](newapi.md) |
| **OneAPI** | 自建网关（开源） | — | [→](oneapi.md) |
| **PPIO 派欧云** | 国内云算力 + 模型 | [ppio.com](https://ppio.com/) | [→](ppio.md) |
| **BurnCloud** | 国内聚合 | [burncloud.com](https://ai.burncloud.com/) | — |
| **AIOnly** | 国内聚合 | [aiionly.com](https://www.aiionly.com/) | — |
| **ocoolAI** | 国内聚合 | [ocoolai.com](https://one.ocoolai.com/) | — |
| **Poe** | Quora 旗下 AI 集市 | [poe.com](https://poe.com/) | — |
| **Vercel AI Gateway** | Vercel 旗下网关 | [vercel.com/ai](https://vercel.com/ai) | — |

## 超低延迟 / 高吞吐推理服务

适合需要"速度感"的场景（IM 机器人、实时翻译等）。

| Provider | 一句话特点 | 官网 | 专题文档 |
|---|---|---|---|
| **Groq** | LPU 硬件，毫秒级响应 | [groq.com](https://console.groq.com/) | [→](groq.md) |
| **Cerebras AI** | 自研芯片，超大上下文 | [cerebras.ai](https://cerebras.ai/) | — |
| **Together** | 开源模型集中托管 | [together.ai](https://www.together.ai/) | — |
| **Fireworks** | 开源模型推理优化 | [fireworks.ai](https://fireworks.ai/) | — |

## 国产云 + 算力服务

| Provider | 一句话特点 | 官网 | 专题文档 |
|---|---|---|---|
| **Silicon (硅基流动)** | 国内最大开源模型托管 | [siliconflow.cn](https://cloud.siliconflow.cn/) | [→](siliconcloud.md) |
| **ModelScope (魔搭)** | 阿里旗下开源模型平台 | [modelscope.cn](https://modelscope.cn/) | [→](modelscope.md) |
| **AlayaNew** | 国内推理服务 | [alayanew.com](https://www.alayanew.com/) | — |
| **Qiniu (七牛)** | 七牛云 AI | [qiniu.com](https://www.qiniu.com/) | — |
| **LANYUN** | 国内推理 | [lanyun.net](https://maas.lanyun.net/) | — |
| **Xirang** | 天翼云息壤 | [ctyun.cn](https://www.ctyun.cn/) | — |

## 嵌入 / 重排专用

只用于做嵌入或重排，配合知识库 / 全局记忆使用。

| Provider | 一句话特点 | 官网 | 专题文档 |
|---|---|---|---|
| **Jina** | 嵌入、重排、CLIP，免费额度大 | [jina.ai](https://jina.ai/) | — |
| **VoyageAI** | 嵌入 / 重排专家 | [voyageai.com](https://www.voyageai.com/) | — |

## 本地推理

完全离线，保护隐私。

| Provider | 一句话特点 | 官网 | 专题文档 |
|---|---|---|---|
| **Ollama** | 命令行本地推理，最流行 | [ollama.com](https://ollama.com/) | [→](ollama.md) |
| **LM Studio** | GUI 本地推理，Apple Silicon 友好 | [lmstudio.ai](https://lmstudio.ai/) | [→](lm-studio.md) |
| **GPUStack** | 企业级本地推理 | [gpustack.ai](https://gpustack.ai/) | — |
| **OpenVINO Model Server** | Intel 加速本地推理 | [openvino.ai](https://www.openvino.ai/) | — |

## 模型平台 / 其他

| Provider | 一句话特点 | 官网 | 专题文档 |
|---|---|---|---|
| **Hugging Face** | 全球最大开源模型社区 | [huggingface.co](https://huggingface.co/) | — |
| **GitHub Copilot** | 微软 GitHub 编程助手 | [github.com/features/copilot](https://github.com/features/copilot) | [→](github-copilot.md) |
| **GitHub Models** | GitHub 模型市场（Beta）| [github.com/marketplace/models](https://github.com/marketplace/models) | — |
| **MiniMax Global** | MiniMax 海外版 | [minimax.io](https://platform.minimax.io/) | — |
| **SophNet** | 国内模型托管 | [sophnet.com](https://sophnet.com/) | — |
| **PH8** | 国内推理 | [ph8.co](https://ph8.co/) | — |
| **Z.ai** | 智谱国际版 | [z.ai](https://z.ai/) | — |
| **nvidia** | NVIDIA NIM 推理 | [nvidia.com](https://www.nvidia.com/ai/) | — |

## 自定义服务商

如果你用的服务不在上面列表里，但提供 **OpenAI 兼容 / Anthropic 兼容 / Gemini 兼容** 任一协议，都可以通过 [自定义服务商](zi-ding-yi-fu-wu-shang.md) 添加。

## 还是不知道选哪个？

直接走 [**CherryIN**](cherryin-1.md) 或 [**CherryAI**](cherryai/) —— 最适合新手快速上手。需要进阶时再换。

***

### 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
