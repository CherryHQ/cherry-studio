# UAR native harness research — 2026-09-24

Scope: read-only CLI/help, config-key/model projections, Context7, official documentation and upstream source. No model inference, sessions, installs or project/global configuration writes. Scratch downloads live in /tmp. Existing project configuration must be merged, never replaced.

## Observed installation and project surfaces

- Codex 0.154.0 at /opt/homebrew/bin/codex. Existing UAR .codex/config.toml holds compass MCP config; .codex/skills and prompts exist; no agents directory initially.
- Claude Code 2.1.282 at ~/.local/bin/claude. Existing .claude/agents/artifact-critic.md must be preserved. User/project/local settings model-only projection showed no model/effort overrides.
- Kimi Code 0.42.0 at ~/.kimi-code/bin/kimi. UAR .kimi-code absent initially. Shared .agents/skills exists.
- OpenCode 1.18.25-fork at ~/.local/bin/opencode. Existing opencode.json has schema and MCP config; .opencode/skills exists, no agents directory initially. Upstream documentation is not full certification of this fork.
- MiniMax mcode absent from PATH. ~/.minimax/bin/minimax and mavis are broken symlinks to missing /Applications/MiniMax Code.app/Contents/Resources/resources/daemon/cli.js. Existing ~/.minimax contains real user state; do not mutate or copy it. MiniMax support is source-only, not runnable certification.

## Codex

Project roles: .codex/agents/<role>.toml. Required name, description, developer_instructions; native model and model_reasoning_effort; supported session-config keys including sandbox_mode. No invented tools array or --agent flag. Avoid built-in default/worker/explorer name collisions. Launch codex -C <UAR-path>, then explicitly ask to delegate to named custom roles. /agent and codex agents concern live sessions, not standalone role validation.

Set BOTH model and model_reasoning_effort when selecting another model: role model alone can preserve a previously resolved effort. sandbox_mode=read-only is a file-write restriction, but interactive parent permission overrides can win. It does not independently deny remote MCP mutation. Prompt ownership is coordination, not enforcement.

Executed codex debug models, exit 0; visible IDs and declared efforts:

| IDs | Efforts |
|---|---|
| gpt-6-astra, gpt-5.6-sol, gpt-5.6-terra | low, medium, high, xhigh, max, ultra |
| gpt-5.6-luna | low, medium, high, xhigh, max |
| gpt-5.5 | low, medium, high, xhigh |
| kimi-k3:cloud | none, low, high, max |
| glm-5.3:cloud, glm-5.3-flash:cloud | low, high, max |
| gemma4:31b:cloud | none, medium |
| deepseek-v4.1-flash:cloud | none, low, high, max |

Hidden gpt-reserve/codex-auto-review are not recommended. Catalog visibility does not prove inference. Current public docs already mention GPT-6 Sol/Luna absent from this local catalog; prefer observed IDs.

Validation: --strict-config and doctor --json exist. Bounded doctor --json probe timed out after 10 seconds without JSON; no success claimed. debug models --bundled is available but proves only bundled catalog. No noninteractive standalone role validator found.

Skills: project .codex/skills and .agents/skills; user $CODEX_HOME/skills, ~/.agents/skills, plugins/admin roots. [[skills.config]] controls skill enablement, not Claude-style preloading.

Sources: [official subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [role schema](https://github.com/openai/codex/blob/main/codex-rs/agent-roles/src/agent_role_config.rs), [skill roots](https://github.com/openai/codex/blob/main/codex-rs/ext/skills/src/host_roots.rs). Context7 /openai/codex and local help first.

## Claude Code

Project roles: .claude/agents/<role>.md; YAML name, description, model, effort, tools/disallowedTools, optional skills; body is role prompt. Native aliases: sonnet, opus, haiku, fable, inherit. Current official docs resolve opus to Opus 5.5 on Anthropic API at this installed version, sonnet to Sonnet 5; actual account entitlement was not queried. Use documented native alias or inherit rather than transplanting a gateway ID.

effort: low, medium, high, xhigh, max, model-dependent. Current Fable/Opus 5.5/Opus 5/Sonnet 5 support all five; Opus 4.6/Sonnet 4.6 omit xhigh. Do not attach effort to haiku without model evidence. Read-only scout/reviewer should positively allow Read, Glob, Grep and specifically required retrieval tools. Denying only Write/Edit leaves Bash and MCP mutation available. skills preloads content; do not confuse this with a tool allowlist.

Launch in UAR cwd: claude --agent <role>; --model and --effort supported. Discovery: interactive /agents. Installed claude agents --help says Manage background agents; --json emits active sessions, NOT custom-role validation. doctor is health/config diagnostic, not proof all roles launch. No inference attempted.

Skills: project .claude/skills/<name>/SKILL.md, global ~/.claude/skills, plugins. Project agent fields differ from plugin agents; install project definitions here.

Sources: [subagents](https://code.claude.com/docs/en/sub-agents), [models](https://code.claude.com/docs/en/model-config), [skills](https://code.claude.com/docs/en/skills). Context7 /websites/code_claude and installed help.

## Kimi Code

Project roles: .kimi-code/agents/<role>.md. Supported fields name, description, whenToUse, override, tools, disallowedTools, subagents. Unknown fields are ignored, including model and OpenCode mode. DO NOT claim per-role model/effort frontmatter works. Tools list or comma string: omitted/* inherits; [] disables all. Denylist applied after allowlist and enforced before execution. subagents is also enforced; the main agent effective list includes discovered custom agents.

Project root is nearest .git ancestor. Precedence: explicit --agent-file > project (.kimi-code/agents, .agents/agents) > extra > user > plugin > built-in. Avoid override=true and built-in names.

Launch in UAR cwd: kimi --agent <role> --model kimi-code/k3; or --agent-file .kimi-code/agents/<role>.md. Cannot combine with --session/--continue. Invalid explicit file errors; malformed directory-discovered files are skipped with warnings.

Executed kimi provider list --json, projected to models only before printing (raw providers can contain secrets). Configured aliases: kimi-code/k3, kimi-code/k3-256k, kimi-code/kimi-for-coding, kimi-code/kimi-for-coding-highspeed. k3/k3-256k support low/high/max, default high. --model selects invocation model. Subagents resolve explicit tool pool alias or [secondary_model].default_model, otherwise caller; primary inherits model+effort. NO --effort in installed help; do not fabricate. Global thinking/pool configuration is separate from role installation.

Validation: kimi doctor config [path] checks TOML, not roles; doctor tui checks TUI config. No noninteractive native role listing found. Label launch acceptance unverified.

Skills: project .kimi-code/skills and .agents/skills; user $KIMI_CODE_HOME/skills and ~/.agents/skills. Repeated --skills-dir REPLACES auto-discovered user/project roots, so avoid casual use. Native base_prompt/skills interpolation can preserve built-in prompt sections; the exporter itself does not expand variables.

Sources: [agents](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/customization/agents.md), [skills](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/customization/skills.md), [model configuration](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/configuration/config-files.md). Context7 /moonshotai/kimi-code and installed help.

## OpenCode

Project roles: .opencode/agents/<role>.md, filename defines role name. Frontmatter description, mode (primary/subagent/all), model provider/model, permission map. permission is singular. Read-only reviewers should deny edit and bash and constrain other mutating tools. Native model/effort options are provider-specific, not universal.

Launch from UAR cwd: opencode --agent <primary-role>, or opencode run --agent <role> for separately authorized runs. Subagent-only roles are delegated/@mentioned, not advertised as main-session roles. Upstream CLI documents --model provider/model, --variant, run --dir. Installed root/run help intermittently returned empty output; agent/debug/models help returned concrete commands.

Executed opencode models --pure, exit 0. --pure disables external plugins. Catalog includes openai/gpt-5.5, openai/gpt-6-astra, openai/gpt-5.6-sol/terra/luna, minimax/MiniMax-M3, kimi-code-plan-global/k3, kimi-for-coding/k3, openai-proxy/gpt-5.5. A broad catalog does NOT prove credentialed provider availability. No provider configured/tested. Inherit native model unless explicit provider identity is established.

Installed help confirms opencode agent list, debug agent <name>, debug skill. Bounded agent list --pure probe timed out after 10 seconds without output; do not claim native role discovery succeeded. Avoid dumping debug config because it may contain secrets.

Skills: .opencode/skills, .claude/skills, .agents/skills in project ancestry, global equivalents. permission.skill patterns control access, not Claude-style preloading.

Sources: [agents](https://opencode.ai/docs/agents/), [CLI](https://opencode.ai/docs/cli/), [skills](https://opencode.ai/docs/skills/), [upstream source](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/agents.mdx). Context7 /anomalyco/opencode and installed help.

## MiniMax Code

Canonical location: <active-data-dir>/agents/<role>/agent.md. A project .minimax/agents directory is not automatically an agent discovery root. Use a Node launcher that resolves an absolute UAR-local data directory, sets child-only MINIMAX_DATA_DIR, sets cwd to UAR, and passes arguments unchanged to an explicitly installed mcode. Example design: .minimax as active data directory; tracked agents subtree; exclude generated sessions/auth/config/database state. Do not change HOME or global ~/.minimax. Isolated data directory also isolates native login/config; do NOT copy ~/.minimax wholesale. Existing credential environment references can pass normally; configuring an isolated provider is separate from staging agents.

Canonical fields: name, description, model (provider/model form required), effort string, tools/disallowedTools arrays, mcpServers array, skills array, x-mavis object. Empty tools disables inventory; comma strings invalid. Unknown fields produce diagnostics, not guarantees. Parser tests cover minimax/MiniMax-M3 with effort on/off; this proves syntax, not installed availability. Gateway alias MiniMax-M3 alone is invalid model syntax. Native tool names include lowercase write, edit, task/task_append; verify portable capitalized-name mapping before claiming enforcement. Omitting model/effort safely inherits the isolated runtime configuration.

Source CLI supports mcode [prompt], mcode --model provider/model; exec [prompt] --cwd <path> --model provider/model --effort <level> --config <path>. Neither interactive nor exec contract has --agent/--agent-file. Do not invent a selector. Exact native custom-agent activation is unverified here; files can be staged but no claim that CLI can select them directly. mcode provider list --json is source-confirmed discovery (sanitize output). provider test and provider add --use can invoke inference; not run. No standalone role validator found. Report missing executable and source-only staging truthfully.

Skills: active-data-dir/agents/<role>/skills and active-data-dir/skills; external project .minimax/skills, .claude/skills, .agents/skills when enabled; external user ~/.claude/skills, ~/.codex/skills, ~/.agents/skills also possible. Isolated data directory does not guarantee complete skill isolation.

Sources: [canonical role config](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/local-runtime-v2/src/service/agent/storage/canonical-agent-config.ts), [CLI contract](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/tui/src/cli/contract.ts), [CLI program](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/tui/src/cli/program.ts), [data-dir resolver](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/tui/src/runtime/data-dir.ts), [skills roots](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/local-runtime/src/skills/roots.ts). Firecrawl developer search found upstream README and issue #158. Context7 returned a different MiniMax platform CLI, so it was rejected rather than misused.

## Independent candidate design

Four prompt-portable roles:

1. uar-lead: user intent, OpenSpec/KBD position, task slicing, file ownership, integration and final evidence. One writer/build owner per shared directory. Hard model tier: e.g. Codex Astra high, Claude opus high, Kimi invocation k3 high. Other harnesses inherit until exact provider identity is chosen.
2. uar-scout: reads architecture, call paths and current docs; returns cited evidence and unknowns. No writes, arbitrary shell, or mutating MCP. Lower-cost native routing when supported: Codex Luna medium, Claude haiku without effort. Kimi inherits; do not fake role model selection.
3. uar-builder: bounded feature/file ownership and completed production-path integration checks. No publication, scope expansion, or self-certification. Example Codex Terra high, Claude sonnet high, inherited elsewhere.
4. uar-verifier: independent acceptance/regression/security-boundary review. Static review can be no-command; executing tests requires separately scoped shell permission and cannot truthfully be described as filesystem read-only. Reports findings/gaps; lead decides delivery.

Simpler alternative: three roles combining lead/scout, retaining builder and independent verifier. Prefer for small changes: less handoff overhead. Four roles helps when documentation/architecture research overlaps independent implementation.

Failure modes: public catalog IDs lack provider credentials; custom prompts erase base instructions/skills/delegation; incomplete read-only denylists retain shell/MCP mutations; verifier races a builder in the same files/target directory; Kimi model frontmatter silently does nothing; MiniMax project files remain undiscovered because runtime still uses ~/.minimax; isolated MiniMax loses login; native loader skips malformed files while static validation is misreported as registration; files alone never create an autonomous running team.

## Verification boundary

CLI versions/help and Codex/Kimi/OpenCode model discovery succeeded. Codex doctor and OpenCode agent list timed out. MiniMax executable missing. No inference or launch acceptance proven. Project/global configs unchanged. Sources fetched from main/dev are current research snapshots, not release pins. Distinguish installed files, static syntax validation, native discovery, and real inference in completion evidence.
