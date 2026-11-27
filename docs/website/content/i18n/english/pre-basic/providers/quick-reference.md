---
icon: list
---
# All Providers Quick Reference

Cherry Studio includes **60+ Providers**. This page provides an overview table. Once you find your target Provider, **follow the instructions to enter your key to start using it**. Providers with dedicated documentation have jump links; others are configured using the general steps ([Provider Overview](README.md)).

## Usage Steps

1. **Find your target Provider** (use Ctrl/⌘+F to search quickly)
2. Click **Official Website** to register an account and obtain an API Key
3. Find the corresponding Provider in Cherry Studio `Settings → Model Provider`, enter the key, and click "Sync models"
4. Complete the configuration

## One-Sentence Decision Guide

| Your Need | Recommended Direction |
|---|---|
| **Quick start for beginners**, avoiding complex processes | [CherryIN](cherryin-1.md) or [CherryAI](cherryai/README.md) |
| **Strong value for coding and long context** | DeepSeek / Moonshot (Kimi) / Z.ai (Zhipu) / MiniMax |
| **Leading frontier models** | OpenAI / Anthropic / Gemini |
| **One key for 200+ providers** | [OpenRouter](openrouter.md) |
| **Fully local, privacy-sensitive** | [Ollama](ollama.md) / [LM Studio](lm-studio.md) |
| **Enterprise compliance** | [Azure OpenAI](azure-openai.md) / AWS Bedrock |
| **Using [Agents](../../advanced-basic/agent.md)** | [Anthropic](anthropic.md) / [CherryIN](cherryin-1.md) (must support Anthropic protocol) |

## Chinese Model Providers

Model makers based in China. Several offer international platforms (linked below); strong Chinese-language support and relatively affordable pricing.

| Provider | Key Feature | Official Website | Dedicated Doc |
|---|---|---|---|
| **DeepSeek** | Best value for coding and reasoning | [deepseek.com](https://platform.deepseek.com/) | [→](deepseek.md) |
| **Moonshot AI (Kimi)** | Ultra-long context (up to 2 million words) | [moonshot.ai](https://platform.moonshot.ai/) | [→](moonshot.md) |
| **ZhiPu (Z.ai)** | GLM series, multimodal, Anthropic-compatible for Agents | [z.ai](https://z.ai/) | [→](zhipu.md) |
| **MiniMax** | Multimodal (voice, video) | [minimax.io](https://platform.minimax.io/) | [→](minimax.md) |
| **StepFun** | StepFun (Jieyue Xingchen) | [stepfun.com](https://platform.stepfun.com/) | — |
| **LongCat** | Meituan LongCat series | [longcat.chat](https://longcat.chat/) | — |
| **Xiaomi MiMo** | Xiaomi large models | [mimo.mi.com](https://mimo.mi.com/) | — |

## Major International Providers

Frontier models from the leading US and European labs.

| Provider | Key Feature | Official Website | Dedicated Doc |
|---|---|---|---|
| **OpenAI** | GPT series | [openai.com](https://platform.openai.com/) | [→](openai.md) |
| **Anthropic** | Claude series, top choice for Agents | [anthropic.com](https://console.anthropic.com/) | [→](anthropic.md) |
| **Gemini (Google)** | Google large models | [aistudio.google.com](https://aistudio.google.com/) | [→](google-gemini.md) |
| **Azure OpenAI** | Microsoft-hosted OpenAI, enterprise compliance | [portal.azure.com](https://portal.azure.com/) | [→](azure-openai.md) |
| **VertexAI** | Google Cloud hosted | [cloud.google.com](https://cloud.google.com/vertex-ai) | — |
| **AWS Bedrock** | Amazon-hosted multi-provider models | [aws.amazon.com/bedrock](https://aws.amazon.com/bedrock/) | — |
| **Mistral** | Representative of European open-source models | [mistral.ai](https://console.mistral.ai/) | [→](mistral.md) |
| **Grok (xAI)** | Elon Musk's xAI, built-in web access | [x.ai](https://console.x.ai/) | [→](grok.md) |
| **Perplexity** | Search-enhanced conversation | [perplexity.ai](https://www.perplexity.ai/) | [→](perplexity.md) |

## Gateways / Aggregators

Access multiple models with one key, centralized account management.

| Provider | Key Feature | Official Website | Dedicated Doc |
|---|---|---|---|
| **CherryAI** | Cherry official free trial | — | [→](cherryai/README.md) |
| **CherryIN** | Cherry official paid gateway, dual endpoints (OpenAI + Anthropic) | [open.cherryin.cc](https://open.cherryin.cc/) | [→](cherryin-1.md) |
| **OpenRouter** | Largest aggregator, 200+ models | [openrouter.ai](https://openrouter.ai/) | [→](openrouter.md) |
| **AiHubMix** | Multi-vendor aggregator | [aihubmix.com](https://aihubmix.com/) | — |
| **Poe** | Quora's AI marketplace | [poe.com](https://poe.com/) | — |
| **Vercel AI Gateway** | Vercel's gateway | [vercel.com/ai](https://vercel.com/ai) | — |

## Ultra-Low Latency / High-Throughput Inference Services

Suitable for scenarios requiring "speed" (IM bots, real-time translation, etc.).

| Provider | Key Feature | Official Website | Dedicated Doc |
|---|---|---|---|
| **Groq** | LPU hardware, millisecond-level response | [groq.com](https://console.groq.com/) | [→](groq.md) |
| **Cerebras AI** | Proprietary chips, ultra-large context | [cerebras.ai](https://cerebras.ai/) | — |
| **Together** | Centralized hosting for open-source models | [together.ai](https://www.together.ai/) | — |
| **Fireworks** | Optimized inference for open-source models | [fireworks.ai](https://fireworks.ai/) | — |

## Open-Source Model Hosting

| Provider | Key Feature | Official Website | Dedicated Doc |
|---|---|---|---|
| **SiliconFlow** | Large-scale open-source model hosting | [siliconflow.com](https://cloud.siliconflow.com/) | [→](siliconcloud.md) |

## Embedding / Reranking Only

Used exclusively for embeddings or reranking, paired with Knowledge Bases / Global Memory.

| Provider | Key Feature | Official Website | Dedicated Doc |
|---|---|---|---|
| **Jina** | Embeddings, reranking, CLIP, large free quota | [jina.ai](https://jina.ai/) | — |
| **VoyageAI** | Embedding / Reranking specialist | [voyageai.com](https://www.voyageai.com/) | — |

## Local Inference

Fully offline, protects privacy.

| Provider | Key Feature | Official Website | Dedicated Doc |
|---|---|---|---|
| **Ollama** | Command-line local inference, most popular | [ollama.com](https://ollama.com/) | [→](ollama.md) |
| **LM Studio** | GUI local inference, Apple Silicon friendly | [lmstudio.ai](https://lmstudio.ai/) | [→](lm-studio.md) |
| **GPUStack** | Enterprise-grade local inference | [gpustack.ai](https://gpustack.ai/) | — |
| **OpenVINO Model Server** | Intel-accelerated local inference | [openvino.ai](https://www.openvino.ai/) | — |

## Model Platforms / Others

| Provider | Key Feature | Official Website | Dedicated Doc |
|---|---|---|---|
| **Hugging Face** | World's largest open-source model community | [huggingface.co](https://huggingface.co/) | — |
| **GitHub Copilot** | Microsoft GitHub coding assistant | [github.com/features/copilot](https://github.com/features/copilot) | [→](github-copilot.md) |
| **GitHub Models** | GitHub model marketplace (Beta) | [github.com/marketplace/models](https://github.com/marketplace/models) | — |
| **nvidia** | NVIDIA NIM inference | [nvidia.com](https://www.nvidia.com/ai/) | — |

## Custom Providers

If the service you use is not in the list above but supports any of the **OpenAI-compatible / Anthropic-compatible / Gemini-compatible** protocols, you can add it via [Custom Provider](zi-ding-yi-fu-wu-shang.md).

## Still Not Sure Which to Choose?

Go directly with [**CherryIN**](cherryin-1.md) or [**CherryAI**](cherryai/README.md) — best for beginners to get started quickly. Switch later if you need advanced features.

***

### Get Help and Submit Feedback

If you have any questions, bugs, or feature improvement suggestions during configuration or usage, please refer to the official channels provided in [Feedback and Suggestions](../../question-contact/suggestions.md).
