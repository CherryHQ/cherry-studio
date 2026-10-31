---
icon: gear
---

# Settings

Cherry Studio's settings panel covers everything from **model configuration and tools to interface preferences, efficiency tools and system behavior**. The left side of Settings is grouped into **Models / Tools / Preferences / Efficiency / System**; this section maps out the same groups so you can jump to what you need.

### Models

| Setting | Doc | What it covers |
| --- | --- | --- |
| Model Provider | [Model Service Configuration](../../../pre-basic/providers/README.md) | Adding providers, API keys, API host, rotating multiple keys |
| Default Model | [Default Model Settings](default-models.md) | Global default models for chat, naming, translation and more |
| Local Models | [Local Models](../../../pre-basic/settings/local-models.md) | Built-in embedding and OCR models that run offline |
| API Gateway | [API Gateway](../../../advanced-basic/developer-tools/api-gateway.md) | Exposes a local OpenAI-compatible API |

### Tools

| Setting | Doc | What it covers |
| --- | --- | --- |
| MCP | [MCP and External Tools](../../../advanced-basic/extensions/mcp/README.md) | Connecting Model Context Protocol tools |
| Skills | [Skills](../../../advanced-basic/extensions/skills.md) | Adding specialized abilities to assistants or Agents |
| Prompts | — | Not documented yet |
| Browser | — | Not documented yet |
| Web Search | [Web Search Mode](../../../websearch/README.md) | Free web search, Tavily, Volcengine, SearXNG and more |
| Document Processing | [Document Processing](../../../pre-basic/settings/doc-process.md) | Structured parsing of PDFs and complex layouts (MinerU, etc.) |
| OCR | [OCR](../../../pre-basic/settings/ocr.md) | Text recognition engines for images and scans |

### Preferences

| Setting | Doc | What it covers |
| --- | --- | --- |
| General | [General](general.md) | Startup, tray, proxy, hardware acceleration, developer mode |
| Appearance | [Appearance](../../../personalization-settings/README.md) | Theme, accent color, zoom, language, topic layout |
| Notifications | [Notifications](../../../pre-basic/settings/notification.md) | Alerts for assistant messages, backups and finished knowledge bases |
| Data | [Data Settings](../../../data-settings/README.md) | WebDAV / S3 backup and third-party integrations |
| Archive | [Files → Archive](../files.md#archive) | Restore or permanently delete archived assistants, agents, topics, tasks, paintings and files; auto-cleanup interval |
| Usage Analytics | [Usage Analytics](../../../pre-basic/settings/usage.md) | Cost, tokens, requests and daily activity |

### Efficiency

| Setting | Doc | What it covers |
| --- | --- | --- |
| Channels | [Channels](../../../advanced-basic/automation/channels.md) | Connecting Agents to Telegram, Slack and more |
| Device Connections | — | Not documented yet |
| Scheduled Tasks | [Scheduled Tasks](../../../advanced-basic/automation/scheduled-heartbeat.md) | Running Agents on a cron schedule |
| Keyboard Shortcuts | [Shortcut Settings](key-shortcut.md) | Changing, enabling and disabling every shortcut |
| Quick Assistant | [Quick Assistant](../kuai-jie-zhu-shou.md) | A global floating mini chat window |
| Selection Assistant | [Selection Assistant](../selection-assistant.md) | Instant translate / explain / rewrite for selected text |
| Screenshot | — | Not documented yet |

### System

| Setting | Doc | What it covers |
| --- | --- | --- |
| Dependencies | [Environment Dependencies](../../../pre-basic/settings/env-dependencies.md) | Installing and managing runtimes and binaries such as uv and bun |
| About & Feedback | — | Version info, update checks, license and community links |

{% hint style="info" %}
Setting changes **take effect immediately** — no restart needed. Before changing core items such as providers, models or default models, we recommend making a backup in `Settings → Data` first.
{% endhint %}

***

### Get Help and Submit Feedback

If you have any questions, bugs, or feature suggestions during configuration or use, please use the official channels listed in [Feedback and Suggestions](../../../question-contact/suggestions.md).
