# Claude Skills 镜像说明

本目录是面向 Claude 的 skill 文件镜像目录。

- 不要直接在 `.claude/skills` 下创建新 skill。
- 所有 skill 仅在 `.agents/skills` 中创建和维护。
- 更新 `.agents/skills/public-skills.txt` 后，执行 `pnpm skills:sync`。
- `pnpm skills:check` 会校验 `.claude/skills/<skill>/SKILL.md` 与 `.agents/skills/<skill>/SKILL.md` 内容一致。
