# Native export contracts

Source inspection: 2026-09-24. These are source-verified staging adapters, not installed CLI certification. Documentation snapshots are identified as snapshots, not invented release pins. Every export includes `export-receipt.json` with the adapter source/version and caller-supplied native provenance; the staging command adds its separate `team-export.json` receipt.

`exportTeam(team, target)` returns an `ExportResult` containing file contents, diagnostics, instructions and verification. It never writes files, installs packages, registers agents, starts processes, activates Hands or invokes agents. Native execution loops retain authority. Role ownership and dependencies in prompts are coordination instructions, not permission enforcement.

## Configuration preservation

Role `native[target]` objects merge recursively over native agent defaults; arrays replace. Unknown fields survive and require native validation. OpenCode's native `prompt` override becomes the Markdown body. DeepSeek role native values configure its persona plugin. The other Markdown harnesses use native frontmatter, with the portable prompt as the body; supply arbitrary standalone native files for richer unsupported formats. Literal `${base_prompt}` is not interpolated. Claude plugin agents ignore `hooks`, `mcpServers`, `permissionMode`, `initialPrompt` and `omitClaudeMd`; exports diagnose supplied fields and retain the project agent alternative. Current [Copilot source types](https://github.com/github/copilot-cli/blob/main/_autodocs/types.md) support `skills: string[]` for startup loading.

Team `native[target].options` means native Codex project config, Claude project settings, OpenCode project config, UAR per-artifact defaults, BossFang Hand definition overrides, or DeepSeek experimental team service configuration. For Kimi, MiniMax and Copilot the object is retained in `native-options.json` without automatic application because this exporter has not verified a suitable project-level configuration location. All targets preserve a verbatim JSON rendering of the options and caller source/version. This preservation is not validation or application.

`native[target].files` preserves UTF-8 strings at supplied staging-relative paths. Traversal, absolute/Windows drive paths, backslashes, portable reserved path components, case-insensitive collisions and file/directory overlaps fail. The staging/provenance/options filenames are reserved. Generated files cannot be replaced through opaque files; use role overrides or choose a distinct path and explicitly install that alternate artifact. IDs use portable lowercase kebab-case. No credentials should be embedded in manifests: reference native credential environment settings instead.

JSON flow syntax is used as YAML 1.2 for frontmatter and Cordis patch files. This preserves literal quotes, newlines and arbitrary JSON option structures without hand-built YAML interpolation. TOML uses quoted keys and nested inline tables; null values fail because TOML cannot represent null.

## Harnesses

| Target | Emitted native artifacts | Contract and limits |
| --- | --- | --- |
| Codex | `.codex/agents/<name>.toml`, optional `.codex/config.toml` | Required `name`, `description`, `developer_instructions`; native `model` and other config keys are retained. [Standalone subagent docs](https://learn.chatgpt.com/docs/agent-configuration/subagents). Plugin skill support does not verify an `agents` plugin manifest field, so none is invented. |
| Claude Code | `.claude/agents/<name>.md`, optional `.claude/settings.json`; alternative plugin `plugins/<team>/agents/` and `.claude-plugin/plugin.json`; `.claude-plugin/marketplace.json` | Native subagents, not automatic experimental agent-team creation. Install either project agents or the plugin copy. [Subagents](https://code.claude.com/docs/en/sub-agents), [plugin structure](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/plugin-structure/SKILL.md), [marketplace schema example](https://github.com/anthropics/claude-code/blob/main/.claude-plugin/marketplace.json). |
| Copilot | `.github/agents/<name>.agent.md` | Native custom-agent frontmatter and body. CLI `/agent` or `--agent` selection is separate from Fleet execution. No unverified marketplace mapping emitted. [Configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration). |
| Kimi Code | `.kimi-code/agents/<name>.md`; alternative `plugins/<team>/kimi.plugin.json` with `agents` directories, and v2 `marketplace.json` | Current MoonshotAI/kimi-code, not archived kimi-cli. Role model frontmatter is ignored; choose invocation/global secondary model separately. Project or plugin agent discovery does not create a running team. [Agents](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/customization/agents.md), [plugins and v2 marketplace](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/customization/plugins.md), [manifest schema](https://github.com/MoonshotAI/kimi-code/blob/main/packages/klient/src/contract/global/plugins.ts). |
| MiniMax | `agents/<name>/agent.md`, relative to the active user-data directory | Inspected `@minimax-ai/code` 0.4.12. Destination is `MINIMAX_DATA_DIR`, `MAVIS_DATA_DIR`, or default `~/.minimax`, not an assumed project agent directory. `mcode exec` lacks a custom-agent selector. Plugin manifest has no agent mapping. [Canonical frontmatter](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/local-runtime-v2/src/service/agent/storage/canonical-agent-config.ts), [CLI contract](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/tui/src/cli/contract.ts). |
| OpenCode | `.opencode/agents/<name>.md`, optional `opencode.json` | Deployed singular `agent`, `permission`, `prompt` schema. Colliding config/Markdown agent names fail. Plugins are a separate JS/TS/npm facility. [Agents](https://opencode.ai/docs/agents/), [plugins](https://opencode.ai/docs/plugins/). |
| DeepSeek Harness | `.dsh/profiles/<team>-<role>/cordis.patch.yml`; separate `<team>-team` composition profile | Cordis `insert` entries configure persona roles. Separate composition enables durable session storage and both experimental team packages; it does not declare or create members. Team options configure `dsh-experimental-agent-team`. No per-member model, remote worker or worktree isolation is promised. [Cordis publishing](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md), [persona](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/persona/README.md), [experimental team source](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/agent-team/README.md). |

## Claude Code validation

Observed with Claude Code 2.1.282 on 2026-09-24: `claude agents` refuses
non-interactive stdout; its suggested `claude agents --json` succeeds but lists
running sessions (PID, working directory and status), not definitions in
`.claude/agents/`. Neither a session listing nor `--version` validates exported
custom roles. Do not treat an absent role in that listing as an exporter failure.

Use the installed version's documented custom-subagent discovery surface and
confirm the expected project role/source appears. If no suitable discovery probe
is available, check frontmatter and source contracts and report source/syntax-only
support; do not invent a CLI subcommand or start inference merely to list roles.
Current [subagent documentation](https://code.claude.com/docs/en/sub-agents)
describes file watching, with a restart needed for the first file in a newly
created agents directory, added-directory changes, or disabled slash commands.
The [agent view](https://code.claude.com/docs/en/agent-view) is a separate session
monitoring surface. Record the tested version and distinguish discovery from
successful invocation.

## Service registration artifacts

UAR 1.0.0 source commit `ba12845138104d3c8c3b8bca8bc7c5be24004e91`: `src/uar/domain/artifact.rs`, `api/discovery.rs`, `api/routes.rs`, `api/compiler.rs`, `security/middleware.rs`. Each `uar/agents/<role>.json` is a complete `AgentArtifact` for `POST /api/agents`. `runtime.entry=default`; policy provider defaults can inherit through empty strings. `policy.skills.prefer` is a preference, not a deny policy. UAR role overrides apply after team defaults. Explicit tool allowlists and bundles start empty; select required native tool permissions through overrides before registration. No persistent native team API is asserted. Execution uses a separate `POST /api/uar/runs` with full `artifact` and `input`; it is not attempted by export.

BossFang 2026.7.11 source commit `c719a4d683e4d3fb42e436f812e0193f865c9d2c`: `crates/librefang-types/src/agent.rs`, `crates/librefang-hands/src/lib.rs`, API routes `agents/lifecycle.rs`, `skills/hands.rs`, `workflows/workflow.rs`. Native agent TOML stores the prompt inside `model.system_prompt`. Standalone request JSON wraps it as `manifest_toml` for `POST /api/agents`. An empty portable skill list exports `skills_disabled=true`; native `skills=[]` with `skills_disabled=false` means all. Agent MCP `[]` means none and `["*"]` means all. Preserve the original manifest because native GET is a projection.

The alternative multi-agent `HAND.toml` uses native `agents.<role>` entries and explicit coordinator, and `hand-install.json` targets `POST /api/hands/install`. `HandAgentManifest` flattens the native manifest (`librefang-hands/src/lib.rs:338–354`); `parse_multi_agent_entry` accepts nested model tables (`:441–531`). Hand-level allowlists retain their own native semantics. Team native options merge into this Hand definition. Activation is a separate action that may launch autonomous schedules. `workflow.json` uses native `agent_name`, `prompt` and `depends_on` fields and targets `POST /api/workflows` after standalone agents are registered. The route parses dependencies (`routes/workflows/workflow.rs:50–80`); nonempty edges select DAG execution and topological layers (`librefang-kernel/src/workflow.rs:3710–3712`, `:5182`). Choose the standalone workflow or Hand deployment deliberately to avoid duplicate agents.

Each `registration-plan.json` is explicitly an exporter review plan, not an API body. An operator must supply base URL and credential reference and retain per-request returned IDs/outcomes. Registration is not atomic; UAR defaults JWT-required, while BossFang supports Bearer or X-API-Key. Discovery health does not grant mutation authority. No live service acceptance or authentication validation is claimed.
