# Anthropic

Anthropic's Claude is one of the best models to serve as the backend for [Cherry Agent](../../advanced-basic/agent.md), as Agent requires an Anthropic protocol endpoint.

## Get API Key

* Register an account at [Anthropic Console](https://console.anthropic.com/)
* Go to `Settings → API Keys` → `Create Key`, and copy the generated `sk-ant-...` key

## Configure in Cherry Studio

* Open `Settings → Model Provider`, find the **Anthropic** Provider, and enter the details page
* Enter your `sk-ant-...` in the **API Key** field
* The **API Address** defaults to `https://api.anthropic.com`; no changes are needed
* Click **Fetch Model List** and add models such as `claude-opus-4`, `claude-sonnet-4`, and `claude-haiku-4`

## Recommended Usage

| Model | Suitable Scenarios |
|---|---|
| `claude-opus-4` | Strongest reasoning / coding / complex Agent tasks |
| `claude-sonnet-4` | General conversation and daily Agent use; best value for money |
| `claude-haiku-4` | High-throughput scenarios, low-cost fast responses |

## Agent Scenario Configuration

Select this Provider as the default model source when configuring [Cherry Agent](../../advanced-basic/agent.md) to directly access Anthropic protocol Agent capabilities.

{% hint style="info" %}
* Users with a Claude Code subscription can also use the same key + endpoint to connect to Cherry Studio
* Claude models are billed by token; monitor usage for long contexts
{% endhint %}

***

### Get Help and Submit Feedback

If you have any questions, bugs, or feature improvement suggestions during configuration or usage, please refer to the official channels provided in [Feedback and Suggestions](../../question-contact/suggestions.md).
