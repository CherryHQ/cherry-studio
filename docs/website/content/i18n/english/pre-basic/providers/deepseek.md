# DeepSeek

DeepSeek builds the DeepSeek V series of models, known for strong coding and reasoning at low prices. Its API platform is available worldwide.

## Get API Key

* Sign up on the [DeepSeek Platform](https://platform.deepseek.com/)
* Go to **API Keys** → **Create API Key** and copy the `sk-...` key
* Top up your balance before first use; the API is pay-as-you-go

## Configure in Cherry Studio

* Open `Settings → Model Provider`, find **DeepSeek** and open its page
* Click **Add API key**, paste your `sk-...` key, then click **Save and close**
* The **API Host** defaults to `https://api.deepseek.com`; no change is needed
* Click **Sync models** and add the models you want (for example **DeepSeek V4 Flash** for everyday use and **DeepSeek V4 Pro** for harder tasks)

## Native Web Search

Some DeepSeek models can search the web natively. Look for the 🌐 icon next to the model name; support can change as the provider updates its models.

When you turn on 🌐 in a conversation, Cherry Studio uses the search service configured in **Settings → Web Search** by default. To let the model use its own web search instead, turn on **Prefer model-native web tools** there. See [Web Search Mode](../websearch/README.md).

## Using DeepSeek With a Knowledge Base

DeepSeek does not offer embedding models. To build a knowledge base:

* Use an embedding model from another provider (for example `text-embedding-3-small` from [OpenAI](openai.md)) or a built-in [local embedding model](../settings/local-models.md)
* You can still use DeepSeek as the chat model

{% hint style="info" %}
- DeepSeek bills by token, and cache hits cost much less; see the official pricing page for details
- Thinking content is shown in the conversation by default; you can turn on **Auto-collapse thinking content** in [Appearance](../settings/display.md)
{% endhint %}

***

### Get Help and Submit Feedback

If you have any questions, bugs, or feature suggestions during configuration or use, please use the official channels listed in [Feedback and Suggestions](../../question-contact/suggestions.md).
