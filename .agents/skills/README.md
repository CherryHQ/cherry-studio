# Skills Management

This directory is the single source of truth for repository skills.

## Add a New Skill

1. Create a new folder under `.agents/skills/<skill-name>/`.
2. Add a `SKILL.md` file with:
   - `name` and `description` in YAML frontmatter
   - concise workflow instructions in the body
3. (Optional) Add `agents/openai.yaml` if Codex UI metadata is needed.
4. If this skill should be shared in the repository, append `<skill-name>` to `.agents/skills/public-skills.txt`.

## Naming Rules

- Use lowercase letters, digits, and hyphens only.
- Prefer short, action-oriented names (for example: `gh-create-pr`).

## Claude Compatibility

For each new skill, create a directory in `.claude/skills` and symlink only `SKILL.md`:

```bash
mkdir -p .claude/skills/<skill-name>
ln -s ../../../.agents/skills/<skill-name>/SKILL.md .claude/skills/<skill-name>/SKILL.md
```

This keeps Codex and Claude Code using the same `SKILL.md` source while avoiding directory-level symlink coupling.

## Windows Symlink Notes

On Windows, symbolic links may not work unless symlink support is enabled.

- Before changing skill links, enable Windows Developer Mode (or use an elevated shell that can create symlinks).
- If symlinks are restricted in your environment, use WSL to perform skill link changes.

## White-list Tracking Rules

The public white-list is defined in `.agents/skills/public-skills.txt`.

- Skills listed there are synced to both `.agents/skills/.gitignore` and `.claude/skills/.gitignore`.
- Private/local-only skills should stay out of `public-skills.txt`.

After updating `public-skills.txt`, run:

```bash
pnpm skills:sync
```

Then validate:

```bash
pnpm skills:check
```

The sync/check scripts manage and verify:

- `.agents/skills/.gitignore`
- `.claude/skills/.gitignore`
- `.claude/skills/<skill-name>/SKILL.md` linkage to `.agents/skills/<skill-name>/SKILL.md`
