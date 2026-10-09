---
description: 双语文档配对契约、渐进范围、一致性记录与验证命令
---

# 双语文档

[English](README.md) | 中文

英文和简体中文具有同等权威。变更可以从任一语言开始，但范围内文档只能以一组完整、且当前内容已共同评审的 pair 合并。

## 配对契约

每个 pair 由三个同级文件组成：

- `foo.md` — 英文。
- `foo.zh.md` — 简体中文。
- `foo.i18n.yaml` — 两侧最后一次确认一致时的 Git blob hash。

Sidecar 是一致性指纹，不是翻译质量证明。修改任一侧后，只修补受影响的对侧文本，评审语义，再显式重录 pair。重命名或删除时必须同时处理三个文件。

普通文档在 H1 后立即放置规范的 English/中文同级文件切换器。Agent Note 在固定的 `Status:` 头之后放置切换器。

## 强制结构

门禁检查：

- 三件套完整且 blob hash 为当前内容；
- 规范的语言切换器；
- 标题深度/顺序、围栏代码、表格尺寸、列表类型/起始值/数量和非切换器链接目标一致；
- Frontmatter key 相同，非 description 值精确一致，且两侧都有非空的本地化 `description`。

代码围栏逐字节相同，包括注释。普通链接在两侧保持相同 `.md` 目标；只有语言切换器指向 `.zh.md`。

## Phase 2 范围

发现根位于 `scripts/translation-pairing.manifest.json`，初始覆盖：

- active Agent Note 与 Agent Notes README；
- 根 `CONTRIBUTING.md`；
- 本文档治理目录。

`terminology.md` 作为一张双语表生成，因此排除 pairing。Agent 指令文件仅保留英文。Phase 3 只在完成已审计 reference 和 contrib 翻译后扩展根。

## 命令

| Command | Purpose |
|---|---|
| `pnpm docs:check-pairing` | 检查当前全部根。 |
| `pnpm docs:check-pairing <pair...>` | 更新期间检查指定 pair。 |
| `pnpm docs:check-pairing --write <pair...>` | 记录已经完成语义评审的 pair。 |
| `pnpm docs:check-pairing --write --all` | 在 corpus 操作后显式记录所有完整 pair。 |
| `pnpm docs:check-pairing --list` | 报告 pair 状态但不失败。 |

Pre-commit hook 只对 staged pair 产物运行 `--cached`，防止 sidecar 确认未暂存内容。`pnpm docs:check` 和 CI 仍运行完整 worktree 检查。

## 失败模型

`missing`、`invalid` 和 `out-of-sync` 都是契约违规。绿色门禁只证明文件完整性与结构；技术准确性、自然语言质量和语义等价仍由 reviewer 按照[翻译规则](translation-rules.md)负责。
