# Skills 管理说明

本目录是仓库内 skills 的唯一维护来源（single source of truth）。

## 新增 Skill 流程

1. 在 `.agents/skills/<skill-name>/` 下创建新目录。
2. 添加 `SKILL.md`，包含：
   - YAML frontmatter 中的 `name` 和 `description`
   - 正文中的精简流程说明
3. （可选）如需 Codex UI 元数据，添加 `agents/openai.yaml`。
4. 若该 skill 需要作为仓库公共 skill 跟踪，请将 `<skill-name>` 追加到 `.agents/skills/public-skills.txt`。

## 命名规则

- 仅使用小写字母、数字和连字符（`-`）。
- 优先使用简短、动作导向的名称（例如：`gh-create-pr`）。

## Claude 兼容

每个新增的公共 skill，请执行：

```bash
pnpm skills:sync
```

`skills:sync` 会自动创建/更新 `.claude/skills/<skill-name>/SKILL.md`：

- 创建到 `.agents/skills/<skill-name>/SKILL.md` 的符号链接。
- 若无法创建符号链接，`skills:sync` 会失败，并提示开启符号链接能力或改用 WSL。

## Windows 符号链接说明

在 Windows 上，符号链接可能因系统设置而不可用。

- 修改 skill 链接前，建议先开启 Windows Developer Mode（或使用可创建符号链接的管理员终端）。
- 若当前环境对符号链接有限制，建议使用 WSL 进行相关改动。
- 仓库约束：`.claude/skills/<skill-name>/SKILL.md` 提交到 Git 时必须是符号链接（mode `120000`）。

## 白名单跟踪规则

公共白名单由 `.agents/skills/public-skills.txt` 定义。

- 写入该文件的 skill 会同步到 `.agents/skills/.gitignore` 和 `.claude/skills/.gitignore`。
- 私有/仅本地使用的 skill 不应写入 `public-skills.txt`。
- 每行只写一个 skill 名称。注释行必须以 `#` 开头，不能写行尾注释。

更新 `public-skills.txt` 后，请执行：

```bash
pnpm skills:sync
```

然后校验：

```bash
pnpm skills:check
```

上述脚本会自动维护并校验：

- `.agents/skills/.gitignore`
- `.claude/skills/.gitignore`
- `.claude/skills/<skill-name>/SKILL.md` 到 `.agents/skills/<skill-name>/SKILL.md` 的链接关系
