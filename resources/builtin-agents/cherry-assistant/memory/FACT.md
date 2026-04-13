# Cherry Studio Product Knowledge

## CherryClaw Agent

CherryClaw is Cherry Studio's autonomous Agent type, built on Claude Code SDK. It supports:

- **Soul Mode**: Persistent personality memory. Agent Settings > Essential > Soul Mode toggle. First activation runs Bootstrap to generate SOUL.md (personality) and USER.md (user profile). Users type persona descriptions directly in chat to save. Regular bots need to open persona settings first to upgrade to Soul. Soul mode auto-enables bypassPermissions for file read/write.
- **Memory Files**: SOUL.md (personality definition), USER.md (user profile), memory/FACT.md (long-term knowledge), memory/JOURNAL.jsonl (append-only event log).
- **IM Channels**: Settings > Channels. Supports Telegram (Bot Token), Feishu/Lark (App ID + App Secret + Encrypt Key + Verification Token), QQ (App ID + Client Secret), WeChat (Token Path, requires QR scan login), Discord (Bot Token), Slack (Bot Token + App Token). Each channel binds to one Agent, has allowed_chat_ids (empty = auto-track all), independent permission override, real-time connection status (green/red), and activity logs. In-channel commands: /new, /compact, /help, /whoami.
- **Scheduled Tasks**: Two ways to configure: 1) System Settings > Scheduled Tasks (`/settings/scheduled-tasks`) > Add task; 2) Ask the Agent in conversation to create/manage tasks. Types: Cron (cron expressions, e.g., `0 9 * * *`), Interval (minutes, e.g., 30), Once (specific datetime). Fields: Name, Prompt, Timeout (default 2min), Channel Subscriptions. Features: manual trigger (Run Now), pause/resume, run logs. Auto-pause after 3 consecutive failures.
- **Heartbeat Tasks**: Agent Settings > Heartbeat Setting. Toggle + interval (1-1440 min, default 30). Reads instructions from workspace heartbeat.md, can push to subscribed channels.
- **Permission Modes**: default (read-only), acceptEdits (file operations), bypassPermissions (all tools), plan (default + extended planning). Channels can independently override Agent's default permission mode.

## AI Error Diagnosis

Three-layer system: rule-based classifier (16 categories) > AI fallback summary > AI full diagnosis. Error banners auto-classify and display with "Go to Settings" button. Click banner > View Details > "AI Diagnosis" for structured solutions (category/cause/steps). Results are auto-cached.

## New User Onboarding

First launch triggers guided setup. Options: "Login to CherryIN" (OAuth one-click configuration) or "Choose another provider" (manual setup). After completion, select default model.

## MCP Ecosystem

- Built-in MCP: Settings > MCP > Built-in. Includes Flomo (connect to flomoapp.com for note-taking, requires Flomo account auth), mcp_auto_install (auto-discover and install MCP servers via NPX, beta).
- MCP Marketplaces: Settings > MCP > Marketplaces. 11 sources including MCPWorld (Baidu) and others.
- Connection timeout: 60 seconds to prevent infinite hangs.

## Model & Provider Updates

- Local model Agent support: Ollama and LM Studio can now be used for Agent mode (requires models supporting tool_calling).
- OpenRouter Agent: Supports Agent mode via Anthropic-compatible endpoint.
- Model ID display: When model names are duplicated, selector auto-shows model ID for disambiguation (format: ModelName | model-id).
- CherryIN (open.cherryin.ai): Official aggregation service. One account for all mainstream models (OpenAI/Claude/Gemini/DeepSeek etc.), OAuth one-click login, built-in free models, paid models after top-up.

## Topic Management

- Pin topics: Right-click topic > Pin to top. Enable in Settings > Chat > Topics.
- Export: Right-click topic > Export (Markdown/Image).
