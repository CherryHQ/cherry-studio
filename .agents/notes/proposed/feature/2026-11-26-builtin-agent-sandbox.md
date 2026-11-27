# Agent Note: Base sandbox policy for Agent shell commands, first applied to Cherry Support

Status: proposed

English | [中文](2026-11-26-builtin-agent-sandbox.zh.md)

## Problem

Cherry Support runs on the Claude Code runtime in `acceptEdits` mode. Its skills submit feedback through `lark-cli` and `gh`, and command detection cannot see what a script or raw API call sends. The `support-bash` rule in `src/main/ai/agents/builtin/builtinAgentGuardRules.ts` therefore asks before every interactive Bash or PowerShell call outside Full Access, including local diagnostics such as reading logs. Users approve many harmless commands to reach the few that leave the machine.

Other Agents will want a sandbox later: the Assistant, user Agents, and possibly Pi runtimes. If each one writes its own complete sandbox configuration, the security invariants get copied into every Agent, and one omission reopens a hole. For example, without strict mode, Full Access silently allows unlisted hosts.

[Preserve root approvals and identify subagent requests](../../implemented/bug-fix/2026-11-12-agent-shell-approval-boundary.md) deferred an OS sandbox as a larger boundary change. This Spec takes up that deferral. It defines one base policy that every Agent extends, and enables it for Cherry Support only.

## Proposal

Cherry defines its own runtime-neutral `SandboxPolicy` in three parts.

*Base.* It lives in `src/main/ai/toolApproval/`, next to the guard rules and the command policy, because all three define the tool execution boundary. It holds the defaults and invariants shared by every sandboxed Agent:

- Writes go only to the session workspace, the Agent data directory, and the temp directory.
- Network access uses strict mode with an empty allowlist.
- Bash calls covered by the effective sandbox skip the per-call shell approval. Independent tool and command policy checks still apply. Leaving the sandbox requires approval outside Full Access.
- If the sandbox cannot start or its effective configuration cannot be shown to enforce the resolved policy, the turn fails before running a shell command.
- Only `darwin` resolves a policy. Every other platform resolves none and keeps its current approval behavior.

*Overlay.* Each Agent declares an overlay. An Agent without an overlay gets no sandbox. An overlay may:

- add allowed domains and writable paths;
- choose a network tier: allowlist only, allowlist plus a Cherry preset list, or all hosts. The all-hosts tier is for user Agents only, and only when the user chooses it explicitly.

The merge unions list fields, and a denied domain stays denied even when an overlay allows it. An overlay cannot:

- turn off strict mode for the list tiers;
- make leaving the sandbox approval-free;
- enable `allowAppleEvents`, Unix socket access, or nested user namespaces;
- make the `$HOME` root or shell startup files writable.

The merge function ignores such fields and keeps the base values.

*Adapter.* An adapter translates the merged policy into runtime parameters. This Spec builds only the Claude Code adapter, in `src/main/ai/runtime/claudeCode/`. `settingsBuilder.ts` passes its result as the SDK `sandbox` option. A Pi or Pi Durable adapter, for example through `@anthropic-ai/sandbox-runtime`, is out of scope.

Built-in overlays live in `src/main/ai/agents/builtin/`, next to `builtinAgentGuardRules.ts`. This Spec ships exactly one: an empty Support overlay, which means Support uses the base as is. The Assistant overlay (preset domains) and user Agent overlays (stored in the Agent configuration, with a UI switch and the three tiers) belong to later Specs.

For Support on macOS, the Claude Code adapter sets the following options in addition to the filesystem policy:

```json
{
  "enabled": true,
  "failIfUnavailable": true,
  "autoAllowBashIfSandboxed": true,
  "allowUnsandboxedCommands": true,
  "network": { "strictAllowlist": true, "allowedDomains": [] }
}
```

Support keeps `settingSources: []` to exclude user and workspace settings. The adapter must account for any other settings the CLI applies, including managed settings, and ensure they cannot widen network or filesystem access or exclude commands from sandboxing. Verification calls the SDK's `resolveSettings()` with the same options as the query. It compares the effective `sandbox` settings, plus the `WebFetch(domain:…)` allow rules that feed the sandbox allowlist, against the resolved policy. `resolveSettings()` is marked `@alpha` and does not run an administrator's `policyHelper`, so a deployment that relies on `policyHelper` counts as unverifiable. Both approval guards use the verified sandbox state of the connection that will execute the call. That state must still hold when the connection is reused. If the runtime cannot verify it, keep the sandbox rollout off and retain the current shell approval behavior. Once the sandbox is enabled, a failed check terminates the turn, including in Full Access.

With the sandbox active, a Bash command that needs the network (`gh`, `lark-cli`, `curl`) fails in the sandbox, and the tool result names the denied host. To proceed, the model must request an explicit escape with `dangerouslyDisableSandbox: true`. A base guard requires per-call approval for such requests in interactive turns outside Full Access. The reason tells the user that the command will run outside the sandbox with network access.

`support-bash` continues to deny Bash and PowerShell on headless turns or when no approval responder is available, in every permission mode. In interactive turns it skips per-call approval only for Bash calls covered by the effective sandbox. Without a sandbox, including on Linux and Windows, the existing per-call shell approval applies outside Full Access. Full Access skips interactive shell and escape approvals via `skipInteractiveEffect`. `builtin-destructive` and the JSON command policy stay unchanged.

The network restriction applies to sandboxed Bash. Other tools, including Cherry's MCP web search and fetch, retain their own access and approval policies.

Probe evidence (SDK 0.3.311, native CLI 2.1.311, macOS 26, scripted mock model):

- An `ls`/`uname` command in `acceptEdits` ran without a `canUseTool` call.
- `curl` and Python `urllib` inside the sandbox failed with `<sandbox_violations> deny network-outbound … (host is not on the allow list)` and no prompt.
- A retry with `dangerouslyDisableSandbox: true` reached PreToolUse with the flag in `tool_input`, then arrived at `canUseTool` as an ordinary Bash approval. A PreToolUse `ask` also reached `canUseTool` under `bypassPermissions`.
- Without strict mode, `bypassPermissions` let an unlisted host through silently. With strict mode, the host was denied.
- A write to `$HOME` failed with EPERM. Writes to the cwd, the additional directories, and `$TMPDIR` succeeded.

## Alternatives considered

- A complete sandbox configuration per Agent, with no shared base: the invariants would be copied into every Agent, and a single Agent missing strict mode would silently allow unlisted hosts under Full Access.
- A plugin-style extension framework, or a Pi adapter now: there is no second consumer yet. The base, the merge function, and one adapter are enough until the Assistant or a Pi runtime needs a sandbox.
- Keep asking before every Support Bash call: safe, but the prompts are what users want reduced, and other products use a sandbox precisely to cut them (Cursor reports 40% fewer agent stops).
- Strict allowlist containing the feedback hosts (`github.com`, Feishu) with auto-allow: a script inside the sandbox could submit to those hosts without any approval, which reopens the gap the per-call rule closes. Claude Code's documentation also warns that allowing `github.com` permits exfiltration through domain fronting, and the `lark-cli` host set is unverified.
- Empty, non-strict allowlist with a per-host prompt: under Full Access, unlisted hosts are allowed silently. The `SandboxNetworkAccess` request carries a toolUseID that matches no tool part, so Cherry would need a new approval surface for it.
- `excludedCommands: ["gh *"]` (Claude Code's documented remedy for Go TLS failures): an excluded `gh` runs outside the sandbox through the ordinary tool permission flow. This would defeat the requirement for an explicit escape before a Bash command can run outside the sandbox.
- `enableWeakerNetworkIsolation` so `gh` works inside the sandbox: the explicit escape already serves this use case, and this option widens every sandboxed command's reach to `trustd`.
- `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` for built-in sessions, proposed as an independent first layer in [#25513](https://github.com/CherryHQ/cherry-studio/pull/25513) and closed. The variables it hides carry little: every Cherry-managed model route puts only the internal gateway credential in the CLI environment, which is held in memory, bound to the session and served on `127.0.0.1`, and the external CLI login route puts none. Upstream provider keys live in Cherry's database, which unsandboxed Bash can read anyway. The scrub also removes `CLAUDE_CONFIG_DIR`, which `npx skills` uses to choose its global install directory, so the Assistant's skill installs would land in the user's own `~/.claude`. It strips credential-looking variables from the user's login shell, and on Linux it moves Bash into a separate PID namespace. If a sandboxed Agent later needs these variables hidden, `sandbox.credentials.envVars` deny can remove exactly them.
- Sandbox the Assistant now: it is general-purpose (`npx skills`, package installs, web pages), so the base's empty allowlist breaks it until its overlay adds a preset list.
- Linux and Windows: bubblewrap/socat, or an elevated `claude sandbox install`, are not zero-setup for a desktop user. They keep their current shell approval behavior.
- Wrap the whole Claude Code process in a VM or `sandbox-runtime` (as Claude Cowork does): this would also cover hooks and MCP, but it is a much larger change with its own packaging cost.

## Acceptance criteria

- AC1 — On macOS, an interactive Support session in Default or `acceptEdits` mode runs an otherwise allowed local Bash command inside the sandbox without showing an approval card. (verification: Electron, owner: Support integration implementer)
- AC2 — On macOS, a Support Bash command running in the sandbox cannot reach any network host through `curl` or Python `urllib`. The tool result names the denied host, and no network approval card appears. (verification: unit + macOS native test, owner: Claude Code runtime implementer)
- AC3 — On macOS, a Support Bash call with `dangerouslyDisableSandbox: true` shows the existing Bash approval card in Default and `acceptEdits` modes, including after earlier approvals of the same command. The card reason says the command runs outside the sandbox. A denied call does not run. (verification: unit + Electron, owner: Support integration implementer)
- AC4 — On macOS, a sandboxed Support command cannot write outside the session workspace, the Agent data directory, and the temp directory, in every permission mode. (verification: macOS native test, owner: Claude Code runtime implementer)
- AC5 — Support denies Bash and PowerShell in headless turns and when an approval responder is unavailable, even in Full Access. With an available responder, Full Access skips the escape approval card, and Bash calls that stay sandboxed still cannot reach the network. (verification: unit + macOS native test, owner: Claude Code runtime implementer)
- AC6 — On Linux and Windows, Support sessions receive no sandbox option. With an available responder, Bash and PowerShell calls, where available, still require per-call approval outside Full Access. (verification: unit, owner: Claude Code runtime implementer)
- AC7 — Agents without an overlay (Assistant, Doctor, and user Agents) receive no sandbox option. (verification: unit, owner: Claude Code runtime implementer)
- AC8 — With a real model on macOS in `acceptEdits` mode, a Support feedback submission completes end to end. After a sandbox network denial, the model requests an escape instead of repeating the same sandboxed command, and the user approves once per Bash call that needs network access. (verification: Electron, owner: Support integration implementer)
- AC9 — An overlay that tries to turn off strict mode, make leaving approval-free, enable Apple Events, Unix sockets, or nested user namespaces, or make the `$HOME` root or a shell startup file writable produces a merged policy that keeps the base values. (verification: unit, owner: sandbox policy implementer)
- AC10 — Domains and writable paths added by an overlay appear in the Claude Code sandbox options alongside the base values, and a domain denied by either side stays denied. (verification: unit, owner: sandbox policy implementer)
- AC11 — On macOS with the sandbox enabled for Support, a startup failure or an effective configuration that cannot be verified to enforce the resolved policy produces a visible turn error before any shell command executes, including in Full Access and on reused connections. With the sandbox rollout off, Support keeps the existing per-call shell approval outside Full Access. (verification: unit + macOS native test + Electron, owner: Claude Code runtime implementer)

## Risks

- Model behavior: the model may retry a denied command unchanged. Cursor reported this failure mode and fixed it by changing tool results and tool descriptions. AC8 must pass with a real model before the sandbox ships. If it fails, keep the sandbox off rather than add retry machinery.
- Sandboxed Bash retains read access to files such as `~/.ssh` and can copy them into the workspace. Bash network access requires an escape. Other tools and model requests are outside this network boundary. Read denial is out of scope.
- In an interactive turn with an available responder, Full Access allows escapes without a card. The headless and no-responder denials and the fail-closed sandbox startup behavior still apply.
- A merge bug would widen a sandbox without any visible sign. AC9 and AC10 test the merge function directly. Later overlays add their own cases there.
- Seatbelt (`sandbox-exec`) is deprecated by Apple, and macOS updates have broken other products' profiles. The base's fail-on-unavailable rule makes a failed sandbox start fail the turn visibly. The darwin native test catches SDK upgrades that change behavior.
- Pi and Pi Durable do not use the Claude Agent SDK, so the sandbox does not cover them. The runtime-neutral policy lets a later Pi adapter reuse the base and overlays. Until one exists, a built-in Agent cannot move to a Pi runtime without losing its sandbox.
