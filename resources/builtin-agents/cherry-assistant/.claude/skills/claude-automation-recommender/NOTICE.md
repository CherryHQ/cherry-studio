# Notice

This skill is **claude-code-setup** (or specifically the `claude-automation-recommender`
sub-skill of it), authored by Anthropic and originally published at:

- Source: https://github.com/anthropics/claude-plugins (via `/plugin install claude-code-setup@claude-plugins-official` in Claude Code)
- Plugin version: 1.0.0
- License: Apache License 2.0 (see `LICENSE` in this directory)
- Author: Isabella He <isabella@anthropic.com>, Anthropic

It is bundled into Cherry Assistant verbatim under the terms of the Apache 2.0
license. The original `plugin.json` wrapper has been omitted — only the skill
itself is shipped, since Cherry Studio's runtime loads `.claude/skills/*` directly.

To update: refresh the cache via `/plugin install claude-code-setup@claude-plugins-official`
on the developer's Claude Code install, then copy the latest
`skills/claude-automation-recommender/SKILL.md` and supporting files into this
directory and re-run `pnpm build:builtin-knowledge`.
