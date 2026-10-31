# OpenRouter

OpenRouter is a **unified gateway** that lets you access chat models from 200+ providers (GPT, Claude, Gemini, Llama, DeepSeek, etc.) with a single API key. It uses token-based billing and is ideal for comparing multiple models or avoiding the need to register separate accounts with each provider.

## Get an API Key

* Go to [OpenRouter](https://openrouter.ai/) to register an account
* `Settings → Keys` → `Create Key`, and copy your `sk-or-...` key
* Top up any amount (minimum $1)

## Configure in Cherry Studio

* Open `Settings → Model Provider`, find the **OpenRouter** Provider, and enter its details page
* Enter your `sk-or-...` in the **API Key** field
* The **API Base URL** defaults to `https://openrouter.ai/api`; no changes are needed
* Click **Fetch Model List**; OpenRouter will return hundreds of available models

## Recommended Usage

OpenRouter model IDs follow the format `<vendor>/<model>`:

| Model ID Example | Actual Provider |
| ----------------------------------- | ------------------------- |
| `openai/gpt-4o` | OpenAI GPT-4o |
| `anthropic/claude-sonnet-4` | Anthropic Claude Sonnet 4 |
| `google/gemini-2.0-flash` | Google Gemini Flash |
| `meta-llama/llama-3.3-70b-instruct` | Meta Llama 3.3 70B |
| `deepseek/deepseek-chat` | DeepSeek V3 |
| `x-ai/grok-4` | xAI Grok |

## Use Cases

* **Multi-model A/B testing**: Switch between models freely under the same Cherry Studio Provider without changing Providers
* **Avoid multiple registrations**: Use 200+ models with a single key and one invoice
* **Niche models**: Many smaller providers are only available via OpenRouter (e.g., Cohere, Reka, etc.)

## Native Web Search and URL Reading

OpenRouter chat models support native web search and URL content reading. When selecting a model, look for the 🌐 icon next to its name, and enable 🌐 in the chat input bar.

If **Prefer Configured Search Service** is enabled in [Settings] → [Web Search], Cherry Studio will prioritize external search services. Disable this option to prioritize OpenRouter’s native model capabilities. Providers may charge separately for web requests; actual costs are subject to your OpenRouter bill.

## Relationship with the Anthropic Protocol

OpenRouter wraps all upstream models using the OpenAI protocol format by default. This means:

* ✅ Standard chat, knowledge base, and quick assistants work normally
* ⚠️ For [Cherry Agent](../../advanced-basic/agent.md), it is **recommended to use** Anthropic / CherryIN directly instead of OpenRouter (Agent requires the native Anthropic protocol)

{% hint style="info" %}
- OpenRouter adds a small markup (typically 5-10%) on top of original provider prices, in exchange for "one account for all"
- Some models have a "free" version (free with rate limits); look for entries with the `(free)` suffix when filtering
- See the [OpenRouter Models](https://openrouter.ai/models) page for detailed pricing
{% endhint %}

***

### Get Help and Submit Feedback

If you have any questions, encounter bugs, or have feature improvement suggestions while configuring or using the service, please refer to the official channels provided in [Feedback and Suggestions](../../question-contact/suggestions.md).
