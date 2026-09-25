# Hooks and assistant setup

Load this reference when the user asks for automatic refresh or assistant
registration.

## Install the Compass skill

```bash
compass agent list
compass agent install --platform codex --project
compass install --platform codex --project
compass install --platform PLATFORM
compass PLATFORM install --project
```

- `--project` writes repository-scoped files suitable for review and version
  control.
- Without `--project`, the skill is installed in the user's platform-specific
  configuration directory.
- `--strict` applies only to the supported project PreToolUse guard. Read
  `compass install --help` before enabling it.

Compass installs the canonical `compass` skill plus its `references/` bundle.
It must not overwrite an unowned skill at the destination.

Supported installation targets include Claude, Codex, OpenCode, Kilo, Aider,
Copilot/VS Code, Claw/OpenClaw, Droid, Trae, Hermes, Kiro, Pi, CodeBuddy,
Antigravity, Kimi, Amp, generic Agent Skills, Devin, Gemini, and Cursor. Always
use the platform name reported by `compass install --help`; do not infer a
destination directory and copy files by hand.

Direct platform syntax, such as `compass codex install`, and
`compass install --platform codex` install the same canonical skill. The
`compass agent install --platform codex` namespace delegates to that managed
installer without changing its arguments or output. Direct platform syntax may also
wire platform-specific instructions or hooks. `--project` is not supported
identically by every host, so inspect the command result and report the concrete
files it names.

Remove only the selected managed integration:

```bash
compass uninstall --platform codex --project
compass uninstall --platform PLATFORM
```

`--purge` can remove Compass output and is materially different from removing an
assistant registration. Use it only when the user explicitly wants graph data
removed.

## Repository hooks

```bash
compass hook install
compass hook status
compass hook uninstall
```

Managed hooks preserve an existing hook by chaining or managed-section logic.
Inspect status before replacing unusual custom hook setups. History mode has its
own enqueueing behavior; read `references/history.md` before mixing lifecycle
changes.

Repository checkout hooks are not the authoritative agent-worktree bootstrap:
an agent can resume or move into an existing worktree without a Git checkout
event. Installed agent guidance runs `compass ensure` at session entry and
after a worktree change. The mutable `compass-out/` remains local to that
worktree.

`--strict` is a Claude Code project PreToolUse behavior. It blocks the first raw
read in a session until a Compass query has oriented the agent; it is not a
global security sandbox and does not apply uniformly across platforms.
Codex project setup installs a bounded `hook-guard search` PreToolUse command;
review and trust its exact definition through Codex `/hooks` before relying on
it. `hook-check` remains a compatibility probe for older Compass-generated
configuration. Do not run or script either command directly unless diagnosing
generated configuration.

After project installation, report which files were created or modified and
which should be added to version control. Uninstall must leave unrelated files,
other skills, and non-Compass graph directories intact.
