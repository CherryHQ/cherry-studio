# Grok

Grok is a large model developed by xAI, known for its "casual tone + access to real-time X (Twitter) data."

## Get API Key

* Go to [xAI Console](https://console.x.ai/) to register an account
* `API Keys` → `Create API Key`, copy the `xai-...` key

## Configure in Cherry Studio

* Open `Settings → Model Provider`, find the **Grok** Provider and enter the details page
* Enter `xai-...` in **API Key**
* **API Base URL** defaults to `https://api.x.ai`, no modification needed
* Click **Fetch Model List**, add models such as `grok-4`, `grok-4-fast`

## Recommended Usage

| Model | Suitable Scenarios |
|---|---|
| `grok-4` | Strongest overall, preferred for complex tasks |
| `grok-4-fast` | High throughput, low latency scenarios |
| `grok-3-mini` | Low-cost daily conversation |

## Web Search

Some Grok models have built-in web capabilities, indicated by a small globe icon after the model name. You can enable "Web Search" directly in the chat box. See [Web Search Mode](../../websearch/README.md) for details.

{% hint style="info" %}
* xAI offers a free quota (refreshed monthly), sufficient for daily use
{% endhint %}

***

### Get Help and Submit Feedback

If you have any questions, bugs, or feature improvement suggestions during configuration or usage, please refer to the official channels provided in [Feedback and Suggestions](../../question-contact/suggestions.md).
