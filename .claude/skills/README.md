# Claude Skills Mirror

This directory is a synced mirror for Claude-compatible skill files.

- Do not create new skills directly under `.claude/skills`.
- Create and maintain skills under `.agents/skills` only.
- Update `.agents/skills/public-skills.txt`, then run `pnpm skills:sync`.
- `pnpm skills:check` verifies `.claude/skills/<skill>/SKILL.md` matches `.agents/skills/<skill>/SKILL.md`.
