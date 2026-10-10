# Notice

This skill is **claude-code-setup** (or specifically the `claude-automation-recommender`
sub-skill of it), authored by Anthropic and originally published at:

- Source: https://github.com/anthropics/claude-plugins (via `/plugin install claude-code-setup@claude-plugins-official` in Claude Code)
- Plugin version: 1.0.0
- License: Apache License 2.0 (see `LICENSE` in this directory)
- Author: Isabella He <isabella@anthropic.com>, Anthropic

It is bundled into Cherry Assistant under the terms of the Apache 2.0 license.
The original `plugin.json` wrapper has been omitted — only the skill itself is
shipped, since Cherry Studio's runtime loads `.claude/skills/*` directly.

## Modifications from upstream

Per Apache License 2.0 §4(b), this section lists notable changes Cherry Studio
made to the upstream `SKILL.md`:

- **Added `## Workflow → Phase 0: Confirm Before Scanning` section** before the
  original Phase 1. The upstream skill starts scanning immediately on trigger;
  the Cherry Studio addition requires the agent to first announce the token
  budget (~20–40K) and obtain explicit user confirmation before any filesystem
  read or Bash call. Rationale: Cherry Assistant runs in interactive chat
  sessions where unexpected long scans degrade the UX. The confirmation gate
  lets the user opt for a narrower scope, a verbal-only consultation, or
  deferral. No other behavior is changed.

The `references/*.md` files are unmodified.

## Updating

To update: refresh the cache via `/plugin install claude-code-setup@claude-plugins-official`
on the developer's Claude Code install, then copy the latest
`skills/claude-automation-recommender/SKILL.md` and supporting files into this
directory and re-run `pnpm build:builtin-knowledge`.
