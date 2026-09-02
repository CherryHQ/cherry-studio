---
description: BAChat v0.1 product feature inventory and scope decisions for the lean core edition
---

# BAChat Feature List v0.1

This document defines the target product scope for the BAChat lean edition.
The goal is a desktop AI workspace centered on **work, chat, translation, and
knowledge bases**, with local-first data storage and optional cloud or local
models.

## Scope Labels

| Label | Meaning |
| --- | --- |
| Keep | Part of the v0.1 product and supported long term |
| Supporting | Required by a kept capability but not a standalone product area |
| Optional | Retain only when its dependency and maintenance cost is justified |
| Remove | Exclude from the lean edition and remove code, UI, services, and dependencies in stages |

## v0.1 Core

| Area | Capabilities | Network requirement | Decision |
| --- | --- | --- |
| Chat | Assistants, conversations and topics, streaming replies, attachments, Markdown rendering, import/export, global search | A cloud model needs internet; Ollama and LM Studio can run locally | Keep |
| Work | Agents, workspaces, sessions, tasks, tool approval, file context | Depends on the selected model and tools | Keep |
| Translation | Text translation, language detection, translation history | Uses the selected cloud or local model | Keep |
| Knowledge base | Local file and directory ingestion, document extraction, chunking, vector indexing, retrieval-augmented chat, knowledge tools | Local indexing can be offline; remote embeddings, reranking, OCR, and URL import need network access | Keep |

## Supporting Capabilities

| Area | Capabilities | Decision |
| --- | --- | --- |
| Model configuration | OpenAI-compatible endpoints, Ollama, LM Studio, API keys, models, proxy configuration | Keep; reduce cloud provider families over time |
| Local data | SQLite database, preferences, cache, file storage, migrations, local backup and restore | Keep |
| Desktop shell | Windows, tabs, notifications, shortcuts, system tray, themes, language settings | Keep |
| File processing | Local PDF, Word, Excel, PowerPoint, text, image extraction and preview | Keep only the paths needed for chat attachments and knowledge ingestion |
| Local inference | Local embedding models and their download/runtime support | Keep for offline knowledge bases |
| Prompts | Prompt library, quick phrases, prompt variables | Optional; low cost and useful for chat/work |
| MCP runtime | Manual local stdio MCP configuration and tool approval | Optional; keep only if the work flow needs external tools |

## Features to Remove

| Area | Included capabilities | Why it is outside v0.1 |
| --- | --- | --- |
| Web search | Search-provider settings, web lookup tools, webpage fetching, citations and citation previews | Network-only feature not required by the four core areas |
| MCP marketplace | Marketplace, remote catalog, npx search, remote install, OAuth setup | Adds network, package-install, and maintenance surface |
| Mini apps | Mini app catalog, installation, Webview runtime, permissions, network APIs, activity logs | Separate application platform with a large security and maintenance surface |
| Image generation | Drawing page, image generation forms, history, templates, image download | Separate model API feature |
| CodeMate | Code execution page, Claude Code, DeepSeek Harness, OpenClaw, Hermes Dashboard, CLI configuration | Separate developer-tool product area |
| External channels | Telegram, Discord, Slack, Feishu, QQ, WeChat adapters | Network-only integrations unrelated to the core desktop workflow |
| Cloud sync and third-party imports | WebDAV, S3, Nutstore, Notion, Joplin, Yuque, Siyuan | Retain local backup, Markdown export, and JSON import/export instead |
| Update and telemetry services | Automatic update, provider registry update, analytics, diagnostic upload, remote telemetry | Keep local diagnostics/export only |
| API gateway | Local OpenAI/Anthropic-compatible HTTP gateway and its external access | Not needed unless BAChat is explicitly used as a server |
| LAN transfer | mDNS discovery, local-network pairing, transfer protocol | Separate sync feature |
| Notes | Rich-text notes, note tree, note settings | Knowledge bases continue to accept files without an independent note product |
| File workspace | Standalone files page and file preview tabs | Keep only attachment and knowledge-base file handling |
| Usage and release pages | Usage dashboard and release notes page | Nonessential for the lean product |
| Advanced capture | Screenshot tools, selection assistant, quick assistant | Optional productivity feature; not required for v0.1 |

## Knowledge Base Boundary

The knowledge base remains a core feature with these limits:

1. Accept local files and directories first.
2. Use local embedding when an offline installation is required.
3. Keep local document readers needed by supported file types.
4. Remove URL ingestion and remote document processors by default.
5. Treat OCR and PDF translation as optional extensions, not core requirements.

## Model Boundary

The target provider set is:

| Provider path | Purpose | Decision |
| --- | --- | --- |
| OpenAI-compatible | Generic cloud endpoint and self-hosted gateways | Keep |
| Ollama | Local chat and embedding models | Keep |
| LM Studio | Local chat models | Keep |
| All provider-specific SDKs | Vendor-specific cloud integrations | Remove unless a product requirement names the vendor |

## Removal Phases

1. **Phase 1 — UI and entry points**: Hide or remove routes, sidebar entries,
   settings pages, commands, and onboarding references. The initial core
   navigation reduction is already complete.
2. **Phase 2 — isolated features**: Remove mini apps, image generation, web
   search, external channels, cloud sync/imports, telemetry, updater, LAN
   transfer, and nonessential pages.
3. **Phase 3 — developer and marketplace features**: Remove CodeMate,
   marketplace/catalog flows, remote MCP installation, and API gateway unless
   explicitly retained.
4. **Phase 4 — dependency reduction**: Remove unused provider SDKs, agent
   runtimes, document processors, frontend chunks, native modules, migrations,
   preference keys, and tests after each feature removal.

## Acceptance Criteria

A v0.1 build must:

- launch into the core product without exposing removed features;
- create, continue, search, import, and export chat conversations;
- run the retained work/agent flow;
- translate text and retain translation history;
- create and query a local-file knowledge base;
- support a configured OpenAI-compatible, Ollama, or LM Studio model;
- work without internet after required local models and dependencies are
  installed, except for explicitly selected cloud model calls.
