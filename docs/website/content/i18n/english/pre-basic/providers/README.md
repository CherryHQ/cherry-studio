---
rich: true
icon: cloud-plus
---

# Model Service Configuration

Cherry Studio ships with connection templates for 60+ providers (model service vendors), covering most mainstream models from around the world as well as local inference frameworks. Use the guides below for provider-specific configuration, or the [quick reference](quick-reference.md) to find other providers.

<div data-cards>
<div data-card>

[**Find a Provider**](quick-reference.md)

Open the quick reference to find a provider-specific guide.

</div>
<div data-card>

[**Understand Connection Settings**](../../cherrystudio/preview/settings/providers.md)

Learn about API keys, API hosts, and advanced configuration.

</div>
</div>

### Provider Types

Cherry Studio groups providers by protocol into the following types, which behave slightly differently:

| Type | Compatible protocol | Typical examples |
|---|---|---|
| **OpenAI-compatible** | `/v1/chat/completions` | OpenAI, DeepSeek, SiliconFlow, OpenRouter, most third-party gateways |
| **Anthropic-compatible** | `/v1/messages` | Anthropic, CherryIN, some gateways. **Cherry Agent requires this type** |
| **Gemini** | Google AI Studio / Vertex | Google Gemini, Vertex AI |
| **Bedrock** | AWS Bedrock SDK | AWS Bedrock |
| **Azure OpenAI** | Azure OpenAI Service | Azure OpenAI |
| **Local inference** | Local HTTP service | Ollama, LM Studio, GPUStack, OpenVINO Model Server |
| **Special gateways** | Vendor-specific protocols | NewAPI, OneAPI, AiHubMix, DMXAPI, etc. |

### General Steps to Add a Provider

{% stepper %}
{% step %}

#### Open Settings

Open `Settings → Model Provider`

{% endstep %}
{% step %}

#### Select a Provider

Find the provider in the built-in list and click it to open its details page

{% endstep %}
{% step %}

#### Enter Connection Details

Enter the **API Key** (required) and change the **API Host** if needed (it defaults to the provider's official address)

{% endstep %}
{% step %}

#### Add Models

Click **Sync models** and add the chat, embedding or vision models you use

{% endstep %}
{% step %}

#### Check the Connection (Optional)

(Optional) Click **Model Check** to verify the connection with any chat model

{% endstep %}
{% endstepper %}

### Provider Guides

#### General / Gateways
* [CherryAI (Free)](cherryai/README.md)
* [CherryIN](cherryin/README.md) — dual endpoints (OpenAI + Anthropic), recommended for Cherry Agent

#### International Providers
* [OpenAI](openai.md)
* [Anthropic (Claude)](anthropic.md)
* [Azure OpenAI](azure-openai.md)
* [Grok](grok.md)
* [Groq](groq.md)
* [OpenRouter](openrouter.md)
* [Google Gemini](google-gemini.md)
* [Mistral](mistral.md)
* [Perplexity](perplexity.md)
* [GitHub Copilot](github-copilot.md)
* [MiniMax M Plan](minimax-coding-plan.md)

#### Chinese Providers
* [DeepSeek](deepseek.md)
* [ZhiPu (Z.ai)](zhipu.md)
* [Moonshot AI (Kimi)](moonshot.md)
* [MiniMax](minimax.md)
* [SiliconFlow](siliconcloud.md)

#### Local Inference
* [Ollama](ollama.md)
* [LM Studio](lm-studio.md)

#### Custom Providers
* [Custom Provider](zi-ding-yi-fu-wu-shang.md) — any OpenAI / Anthropic / Gemini-compatible endpoint

{% hint style="info" %}
**Can't find the provider you use?**

Look in the [All Providers Quick Reference](quick-reference.md) first. Open the dedicated guide where one is available; otherwise use the general steps on this page and [Model Service Settings](../../cherrystudio/preview/settings/providers.md). For a compatible endpoint, see [Custom Provider](zi-ding-yi-fu-wu-shang.md).
{% endhint %}

### API Key and API Host

See [Model Service Settings](../../cherrystudio/preview/settings/providers.md) for details, including advanced usage such as rotating multiple keys and ending the host with `#` to use a fixed path.

***

### Get Help and Submit Feedback

If you have any questions, bugs, or feature suggestions during configuration or use, please use the official channels listed in [Feedback and Suggestions](../../question-contact/suggestions.md).
