# Agent Note: Launch-scoped model binding for local Agents

Status: proposed

English | [中文](2026-11-27-local-agent-launch-model-binding.zh.md)

## Problem

Selecting a Cherry model for a local CLI Agent rewrites that CLI's global configuration — `~/.claude/settings.json`, `~/.codex/auth.json` and the homes of twenty other CLIs — with the user-facing API Gateway URL and its long-lived key. It also persistently enables that gateway on its fixed port. The user's own CLI then depends on Cherry running with an unchanged port and key. The key sits in plain text in dotfiles that users commonly sync. One global file cannot hold different models for different Agents or survive concurrent edits by the user and other tools. Codex loses its ChatGPT sign-in mode.

Only OpenCode and Kilo replace the file's key with a session credential at launch. Every other CLI, including sessions Cherry starts itself, uses the public key read from the user's file. DeepAgents and Junie already bind the model at launch without touching user files, so two incompatible mechanisms coexist. The managed OpenClaw and DeepSeek Harness services write their gateway selection into the user's native homes the same way.

## Proposal

The [Agent's provider binding](2026-11-26-desktop-agent-runtime-capabilities.md#agent-provider-data-model) owns the default Cherry model selection. Selecting, switching or clearing a Cherry model writes no CLI file and neither starts nor enables the user-facing gateway.

Every process Cherry spawns for that Agent receives the selection at spawn: chat sessions, scheduled tasks and Cherry-launched terminals. Main resolves the Cherry model, selects an endpoint the CLI accepts and obtains a credential scoped to the launch and model from the internal loopback gateway. It then applies the preset's binding and releases the credential and any binding resources when the process ends. Model catalog, account and sign-in probes run without a binding.

Each preset that offers Cherry models has exactly one entry in the shared launch-binding table:

- **Process.** Environment and arguments only, for CLIs whose launch-time configuration outranks the user's files. Claude Code applies the base URL, token and model roles through SDK flag settings, which take precedence over user settings. Codex selects a Cherry provider with `-c` overrides whose key is read from the child environment. OpenCode and Kilo receive generated configuration through `OPENCODE_CONFIG_CONTENT` and `KILO_CONFIG_CONTENT`, merged into any value the user already passes. goose and GLM receive the generated connection as environment variables through their preset launch hook. DeepAgents keeps its model argument and environment.
- **Overlay home.** The CLI's documented home variable points to a Cherry-owned directory created for this launch. The per-CLI configuration adapters render the CLI's files into that directory from the user's current files plus the Cherry provider. Every other entry links to the user's home: directories as symlinks, or junctions on Windows; files as symlinks, or on Windows as hard links with a copy as fallback. When the launch ends, entries the CLI created return to the user's home, files the CLI replaced are written back only if the user's file did not change meanwhile, and files it deleted are deleted only under the same condition. Generated files are discarded. Startup reconciles overlays left by an abnormal exit with the same rules. A preset whose home variable does not redirect every generated file fails the launch before anything is written.
- **Private file.** Junie keeps its connection-local model profile.

| Strategy | Presets | Redirect |
|---|---|---|
| Process | Claude Code, Codex, OpenCode, Kilo, goose, GLM, DeepAgents | flag settings, `-c`, `*_CONFIG_CONTENT`, environment, arguments |
| Overlay home | Kimi, Pi, OMP, Qwen, CodeBuddy, Copilot, Vibe, Grok Build, Cline, ZCode, Snow | `KIMI_CODE_HOME`, `PI_CODING_AGENT_DIR`, `QWEN_HOME`, `CODEBUDDY_CONFIG_DIR`, `COPILOT_HOME`, `VIBE_HOME`, `GROK_HOME`, `CLINE_DIR`, `ZCODE_HOME`, `SNOW_CONFIG_DIR` |
| Private file | Junie | connection-local profile |
| None | Factory Droid, Poolside, Hermes, MiniMax Code and native-only presets | no Cherry models offered |

Hermes offers no Cherry models. Each Hermes client starts a detached gateway daemon for its home that outlives the launch, and Hermes records absolute paths of the home it ran in. An overlay home therefore leaks a running daemon and stale paths into the user's home, and later launches fail. Hermes has no launch-time setting that outranks its configuration file.

MiniMax Code offers no Cherry models. `mcode` rejects symlinks inside `MINIMAX_DATA_DIR` (including `v2`, `v2/sqlite`, and profile storage) and provides no launch-time setting or override that takes precedence over `MINIMAX_DATA_DIR/config.yaml`.

The per-CLI configuration adapters move from the renderer to `@shared/utils/cliConfig`. Main renders overlay files with the code the raw configuration editor already uses, so each CLI's file format has one owner. The raw **CLI configuration files** editor remains an explicit editor of the user's own files.

Managed shared services follow the same ownership for API Gateway models. When Cherry starts the OpenClaw Gateway or DeepSeek Harness for a model served through the API Gateway, the service reads a configuration Cherry generates outside the user's home, with a service-scoped credential that Cherry releases when the service stops. Direct provider selections keep writing the service's native configuration. External services that Cherry only reuses keep their configuration untouched.

Remove the file-writing gateway selection, the re-reading of gateway routes from user files, `bindCliGatewayRoute`, and the Agents' dependency on the user-facing gateway.

This note partially supersedes the gateway-route paragraph of [Desktop agent runtime capabilities](2026-11-26-desktop-agent-runtime-capabilities.md). Session-scoped attribution in that note stays in force.

## Alternatives considered

- **Keep writing user files, with session credentials.** Still mutates the user's global configuration, still breaks the CLI outside Cherry and still cannot hold per-Agent models.
- **Redirect `HOME`.** Hides macOS Keychain credentials and every other tool's dotfiles from the child process.
- **One persistent private home per Agent.** Diverges sessions, skills and settings from the user's CLI. Concurrent launches of one Agent race on the credential in a shared file.
- **Hand-written provider stanzas per runtime package.** Duplicates file-format knowledge the configuration adapters already own and lets the editor and launch drift apart.

## Acceptance criteria

- AC1 — Selecting, switching or clearing a Cherry model for any preset leaves every file in the user's CLI homes unchanged and leaves `feature.api_gateway.enabled` unchanged. (verification: unit and renderer)
- AC2 — A chat session of each preset with a binding sends model requests to the internal gateway with a credential scoped to that session and model, and the credential stops authorizing requests once the session closes. (verification: unit)
- AC3 — Two concurrent sessions of the same Agent receive distinct credentials and distinct overlay directories. (verification: unit)
- AC4 — Inside an overlay home the CLI reads the user's existing sessions, skills, MCP configuration and sign-in state. After the launch, the entries it created exist in the user's home, a changed copy is written back only when the user's file is unchanged, and no generated file or Cherry credential remains in the user's home. (verification: unit)
- AC5 — After an abnormal exit, the next start reconciles every leftover overlay by the AC4 rules and deletes it. (verification: unit)
- AC6 — A preset whose home variable would leave a generated file outside the overlay fails the launch with an explicit error and writes nothing to the user's home. (verification: unit)
- AC7 — Scheduled tasks and Cherry-launched terminals of an Agent with a Cherry model use the selected model through the same binding. (verification: unit)
- AC8 — Agent Services offers Cherry models only for presets that declare a binding, and Factory Droid, Poolside and Hermes offer none. (verification: renderer)
- AC9 — The OpenClaw Gateway and DeepSeek Harness started by Cherry for an API Gateway model read a Cherry-generated configuration and a service-scoped credential, write no gateway route or credential into the user's native configuration, and release the credential when the service stops. Direct provider selections and external services keep their current configuration. (verification: unit)
- AC10 — The local Agent runtime reference describes launch-scoped binding and no longer documents file-written gateway selections. (verification: docs gate)

## Risks

- Windows links directories with junctions and files with hard links. A file the CLI replaces by rename breaks its hard link and is written back at the end of the launch, and a volume without hard links falls back to a copy.
- A CLI that rewrites a generated file during a session loses that edit, because generated files are discarded.
- A CLI that rotates an OAuth refresh token stored in a generated file rotates only the overlay copy. Cherry-model sessions authenticate with the gateway credential, not the CLI account, which limits exposure.
- Cherry cannot observe a terminal it launched exit, so the terminal's binding lives until Cherry stops. A terminal launched from Cherry outlives its credential when Cherry quits. The internal gateway stops with Cherry, so that terminal loses the Cherry model until it is relaunched.
- A CLI update can move its files or rename its home variable. The AC6 check turns such a change into a launch error instead of a write to the user's home.
