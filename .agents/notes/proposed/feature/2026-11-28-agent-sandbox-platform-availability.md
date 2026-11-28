# Agent Note: Enable the Agent shell sandbox on Linux and WSL2 when the Claude Code CLI reports it can run

Status: proposed

English | [中文](2026-11-28-agent-sandbox-platform-availability.zh.md)

## Problem

[Base sandbox policy for Agent shell commands](2026-11-26-builtin-agent-sandbox.md) resolves a policy only on `darwin`. On Linux, WSL2 and Windows, Cherry Support keeps per-call approval for every Bash call, so most desktop users get none of the reduction in approval prompts.

The Claude Code CLI (2.1.311, bundled with Agent SDK 0.3.311) can sandbox Bash on more than macOS:

- Linux and WSL2 need `bubblewrap` and `socat`, and a kernel that lets bubblewrap create user namespaces. On Ubuntu, `kernel.apparmor_restrict_unprivileged_userns=1` blocks it unless bubblewrap has an AppArmor profile. WSL1 is not supported.
- Native Windows needs a one-time `claude sandbox install`, which elevates once. The CLI's own text also mentions a Windows sandbox that is "not active on this session (feature gate off)", so an installed sandbox may still be unavailable.

The CLI's own check does not cover everything its Linux sandbox needs. Its seccomp helper creates a user namespace nested inside bubblewrap, and Ubuntu's stock AppArmor profile `bwrap-userns-restrict`, loaded by default on Ubuntu 26.04, denies bubblewrap's children the capability that takes. `status` then reports the sandbox available while every sandboxed command fails before it runs. This is an open CLI bug ([anthropics/claude-code#43454](https://github.com/anthropics/claude-code/issues/43454)), and the remedies its docs give do not lift that profile.

Cherry cannot tell from the platform whether a machine meets these conditions. The obvious shortcut, `failIfUnavailable: false`, is unsafe. With it, a CLI that cannot start its sandbox runs Bash unsandboxed while Cherry's guards still treat the connection as sandboxed and skip the per-call card.

## Proposal

Whether a connection gets a sandbox depends on whether its runtime reports a working one. The only platform rule left is that native Windows stays out until it is verified.

*Base policy.* `resolveSandboxPolicy` no longer reads the platform. It takes the runtime's availability answer as an input. With no overlay, or with the sandbox unavailable, it resolves no policy and the Agent keeps its current approval behavior. Writable paths keep their POSIX rules, which cover macOS, Linux and WSL2.

*Claude Code availability.* Before a sandboxed connection is built, the Claude Code adapter runs the bundled CLI as `claude sandbox status`. It sets `CLAUDE_CONFIG_DIR` to a fresh temporary directory whose `settings.json` enables the sandbox, so the user's own Claude Code settings are not read or changed. `status` prints one JSON line. Its `unavailableReason` comes from the same check that makes `failIfUnavailable` refuse to start a session, so the two cannot disagree for a given machine and policy. The sandbox counts as available only when every one of these holds:

- the process exits 0 within 5 seconds;
- the output parses as JSON with `statusVersion` equal to `3`;
- `supported` and `enabled` are `true`;
- `unavailableReason` is `null`.

Anything else counts as unavailable. On Linux, a sandbox that `status` reports available must also pass one trial: `bwrap --unshare-user --dev-bind / / unshare --user --map-root-user true` exits 0 within 5 seconds. It is the nested user namespace the CLI's seccomp helper creates and `status` does not try. Codex, Gemini CLI and Zed install their seccomp filters without a nested namespace, so none of them needs this trial; the bubblewrap probes they and the CLI run stop one level short of it. When the CLI stops nesting a namespace, a later change removes the trial.

Because the check runs once per connection build, a newly installed dependency takes effect on the next connection; no cache is kept. Measured on macOS, one run takes 0.14 s warm and 0.6 s cold.

*Unavailable.* The connection gets no `sandbox` option and `sandboxed` is `false`. `support-bash` therefore asks for every shell call outside Full Access, exactly as on Linux and Windows today. The reason from `status` is logged with the session id so diagnostics can show why the sandbox is off. An unavailable sandbox is not a turn error: on these platforms it is the normal state of a machine that has not been set up.

*Available.* The connection is built as on macOS: the same SDK options, the same settings-tier verification, the same `sandbox-escape` and Support rules, and the same failure-time escape guidance. `failIfUnavailable` stays `true`. If the CLI still cannot start its sandbox, for example because a dependency was removed between the status check and the spawn, the turn fails visibly instead of running unsandboxed.

*Native Windows.* The adapter treats native Windows as unavailable without running `status`, whatever the CLI would report. Nothing about the Windows sandbox has been verified in Cherry: the install state, the feature gate, the denial format the escape guidance reads, and how Windows paths reach the policy. A later Spec enables it after a Windows machine with `claude sandbox install` passes the native suite, and decides whether Cherry offers the install, which changes the machine and needs administrator consent. WSL2 runs the Linux CLI and follows the Linux rules. PowerShell keeps per-call approval on every platform, because the sandbox coverage verified so far is the Bash tool.

*Linux verification in CI.* The Linux test job installs `bubblewrap` and `socat`, lifts the Ubuntu AppArmor user-namespace restriction and unloads the `bwrap-userns-restrict` profile for the job, so the native sandbox test runs against a working sandbox there. Without those steps the same test exercises the unavailable path.

## Alternatives considered

- Repeat the CLI's dependency checks in Cherry (find `bwrap` and `socat` on `PATH`, try a bubblewrap run, read the AppArmor switch): it duplicates checks the CLI already makes and drifts from them when the CLI changes. It also has no answer for the Windows install state or feature gate. Cherry runs only the nested-namespace trial the CLI leaves out.
- Set `allowAllUnixSockets: true`: the CLI then skips its seccomp helper and the sandbox runs on stock Ubuntu, but sandboxed commands can reach any Unix socket, such as those under `/tmp`.
- Ask the user to unload `bwrap-userns-restrict`: it weakens system hardening that Cherry does not own. The logged reason names the cause instead.
- Start the session with `failIfUnavailable: true` and rebuild it without a sandbox when the CLI refuses to start: it costs a failed CLI start per connection on every machine without a sandbox, and it depends on parsing an error message rather than a versioned status format.
- `failIfUnavailable: false`: rejected in the Problem section. The CLI would run Bash unsandboxed while Cherry skips the approval card.
- Cache the availability answer for the app's lifetime: it saves about 0.15 s per connection but goes stale when the user installs bubblewrap or runs `claude sandbox install`, and it adds invalidation rules.
- Trust `status` on native Windows as well: the CLI's own check would decide, but nothing on the Cherry side of the Windows path has been verified, and a CLI release could start the sandbox there without any Cherry change.
- Add a Windows install button now: it needs an elevated action, consent copy and a failure path, and the CLI's Windows feature gate is unverified. It belongs in the later Windows Spec.

## Acceptance criteria

- AC1 — On macOS, a Support session gets the same `sandbox` option and approval behavior as before this change, after `claude sandbox status` reports the sandbox available. (verification: unit + macOS native test, owner: Claude Code runtime implementer)
- AC2 — When `claude sandbox status` exits non-zero, times out after 5 seconds, prints output that is not JSON, reports a `statusVersion` other than `3`, reports `supported` or `enabled` as `false`, or reports a non-null `unavailableReason`, the connection gets no `sandbox` option and every Support Bash and PowerShell call asks outside Full Access. The reason is logged. (verification: unit, owner: Claude Code runtime implementer)
- AC3 — On a Linux CI runner without `bubblewrap`, `claude sandbox status` reports the sandbox unavailable and a Support session falls back to per-call approval. (verification: Linux native test, owner: Claude Code runtime implementer)
- AC4 — On a Linux CI runner with `bubblewrap` and `socat` installed, the AppArmor user-namespace restriction lifted and `bwrap-userns-restrict` unloaded, a Support Bash command runs without a card, cannot reach `example.com` or a loopback server, cannot write outside the workspace, the Agent data directory and the temp directory, and the tool result carries the escape guidance. A `dangerouslyDisableSandbox` call reaches `canUseTool` and does not run when denied. (verification: Linux native test, owner: Claude Code runtime implementer)
- AC5 — On native Windows, a Support session gets no `sandbox` option and per-call approval, and the status check does not run. (verification: unit + Windows native test, owner: Claude Code runtime implementer)
- AC6 — `resolveSandboxPolicy` resolves no policy when availability is `false` and resolves the same policy as before when it is `true`, on every platform; it no longer reads the operating system itself. (verification: unit, owner: sandbox policy implementer)
- AC7 — The status check does not read or modify the user's Claude Code configuration directory and leaves no temporary directory behind. (verification: unit, owner: Claude Code runtime implementer)
- AC8 — On Linux, when `claude sandbox status` reports the sandbox available but bubblewrap cannot create a nested user namespace, as with Ubuntu's `bwrap-userns-restrict` profile loaded, the connection gets no `sandbox` option, Support keeps per-call approval, and the logged reason names anthropics/claude-code#43454. When `status` already reports the sandbox unavailable, the trial does not run. (verification: unit, owner: Claude Code runtime implementer)

## Risks

- The `status` output format can change in a later CLI. Pinning `statusVersion` to `3` turns an unknown format into "unavailable", which keeps per-call approval; the Linux and Windows native tests catch an SDK upgrade that changes it.
- Each sandboxed connection build spends 0.15 to 0.6 seconds on the status check. Warm queries already build connections ahead of use, which hides most of it.
- Until the CLI fixes anthropics/claude-code#43454, Ubuntu releases that load `bwrap-userns-restrict` by default, such as 26.04, keep per-call approval. The Linux benefit of this Spec lands first on distributions without that profile, such as Debian, Fedora and Arch.
- The trial needs `unshare` from util-linux. A system without it counts as unavailable.
- Lifting the AppArmor restriction and unloading the profile apply only inside the CI job. A desktop Ubuntu user with either in place keeps per-call approval; the logged reason names the cause.
- The Linux and WSL2 sandbox has not run with a real model in Cherry. The failure-time guidance depends on the CLI printing `deny network-outbound <host>` on Linux as it does on macOS; AC4 checks that format.
- Windows users see no change from this Spec. Keeping them out is deliberate: without the explicit exclusion, a CLI release that activates the Windows sandbox would switch Support onto it with nothing verified.
