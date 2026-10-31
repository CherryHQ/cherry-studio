# Groq

Groq (Note: not Grok by xAI) is an inference service known for **LPU hardware acceleration and ultra-low latency**. It primarily hosts open-source models such as Llama, Mixtral, and Whisper, with output speeds typically several times faster than standard cloud inference.

## Get API Key

* Go to [GroqCloud](https://console.groq.com/) to register an account
* `API Keys` → `Create API Key`, copy the `gsk_...` key

## Configure in Cherry Studio

* Open `Settings → Model Provider`, find the **Groq** Provider and enter the details page
* Enter your `gsk_...` in the **API Key** field
* The **API Endpoint** defaults to `https://api.groq.com/openai/v1`; no modification is needed
* Click **Fetch Model List**

## Recommended Usage

| Model | Suitable Scenarios |
| ------------------------- | ---------- |
| `llama-3.3-70b-versatile` | General conversation, extremely fast |
| `llama-3.1-8b-instant` | Simple tasks, millisecond-level response |
| `mixtral-8x7b-32768` | Long context |
| `whisper-large-v3` | Speech-to-text |

## Use Cases

* **Real-time chatbots**: Groq's "near-instant response" is ideal for IM integration (paired with [Channels](../../advanced-basic/automation/channels.md))
* **High concurrency**: Tokens per second are significantly higher than standard cloud inference
* **Not concerned with the latest models**: Groq primarily hosts open-source models like the Llama series; it does not offer closed-source models like GPT-5 or Claude-4

## Distinguishing Grok vs Groq

| | [Grok](grok.md) | Groq |
| -- | --------------- | --------------- |
| Company | xAI (Musk) | Groq Inc. |
| Focus | Proprietary LLMs + Web access | LPU hardware + Open-source model inference |
| Models | `grok-4` and other proprietary models | `llama-3.x` and other open-source models |

{% hint style="warning" %}
Grok (xAI) and Groq are often confused. In the Cherry Studio Provider list, they are two separate entries. Please distinguish them carefully.
{% endhint %}

***

### Get Help and Submit Feedback

If you have any questions, bugs, or feature improvement suggestions while configuring or using the service, please refer to the official channels provided in [Feedback and Suggestions](../../question-contact/suggestions.md).
