---
name: cherry-doc-writer
description: 起草结构化 Markdown 文档（技术文档 / PRD / README / 项目说明 / 会议纪要 / 提案 / FAQ 等）。先问关键问题 → 提议大纲 → 用户确认 → 输出完整可读稿。当用户说"写个文档"、"起草 PRD"、"做个 README"、"写个说明"、"整理一下纪要"、"draft a doc"、"write a README"、"create a PRD"、"write up..."时触发。Cherry Studio 内置轻量版；要更深的领域专属能力（enterprise PRD / 合规公文等）→ 走 `cherry-skill-marketplace` 找重型 skill。
---

# Cherry Doc Writer

写得清楚的人类可读 Markdown 文档。**不堆模板套话，写真正能读的东西**。

## 工作方式

### Step 1: 需求捕获（先问，不要急着动手）

最多问 3 个问题，按下面优先级挑：

| 文档类型 | 必问 |
|---------|------|
| PRD / 需求文档 | 1. 解决谁的什么问题？2. 必须 / 应该 / 可以 的范围？3. 验收标准是什么？ |
| README | 1. 这是什么 / 给谁用？2. 怎么装怎么跑？3. 有没有要写的关键概念？ |
| 技术文档 | 1. 读者画像（新人 / 维护者 / 集成方）？2. 是 how-to 还是 reference？3. 已有的相关文档在哪？ |
| 会议纪要 | 1. 谁参会 / 主题 / 时长？2. 决定了什么 / 还没决定什么？3. 行动项分给谁、截止啥时候？ |
| FAQ | 1. 收录范围（产品 / 内部 / 客服）？2. 问题已经有原始来源吗？3. 答案需要可执行步骤吗？ |

信息不全 → 直接问，不要硬塞 placeholder。

### Step 2: 大纲先行

写正文前，**先给用户看大纲**（一级标题列表）。用户确认或修改后再展开。

例：

```
我准备这样组织 PRD：
- Background（为什么做）
- Goal（要达成什么）
- Spec（具体做什么 / 不做什么）
- Verification（怎么验收）
- Related（关联资源）

OK 吗？还是想换个结构？
```

### Step 3: 落稿

**写作原则**：
- **首句承诺，后续兑现**：每段第一句说清楚要讲什么
- **具体优于抽象**：写"启动需 4 秒"而不是"启动较快"
- **示例优于解释**：能给一个 ` ```代码块` ` 就别全文字描述
- **避免空话**：删掉「众所周知」「显然」「最佳实践」「值得注意的是」这类话
- **避免堆 emoji**：除非用户的偏好里明示需要

**Markdown 风格**：
- `##` 为顶层章节，`###` 子章节，**不要**一上来就 `#`
- 列表用 `-` 不用 `*`
- 中英文之间空格（`Cherry Studio 是一款 AI 助手`）
- 代码块标语言：` ```ts `、` ```bash `
- 表格用于结构化对比；纯流水信息别用表格

### Step 4: 交付 + 后续

写完后告诉用户：
- 文件路径（如果落盘了）
- 字数 / 章节数
- 哪些地方信息不足、需要他/她补
- 是否要顺便收录到 FAQ（如果是常见问题）→ 走 `faq-collector`

## 常见输出模板（参考，不要照抄）

### PRD（Cherry Studio 社区版风格）

```markdown
# <一句话标题：解决什么问题>

## Background

<现状 + 为什么这是个问题 + 数据/反馈来源>

## Goal

<期望状态 — 用动词，可衡量>
- ...
- ...

## Spec

### 必须（MUST）

- [ ] ...

### 应该（SHOULD）

- [ ] ...

### 不做（OUT OF SCOPE）

- ...

## Verification

1. ...
2. ...

## Related

- Issue: #...
- Design: ...
```

### README（简版）

```markdown
# <项目名>

<一句话说清楚是什么>

## 安装

```bash
<命令>
```

## 用法

```<lang>
<最小可用示例>
```

## 文档

- ...
```

### 会议纪要

```markdown
# <主题> — YYYY-MM-DD

**参会**: A, B, C  **时长**: 60 min  **主持**: A

## 决议

- ✅ <已决定的事>
- ⏸ <暂时搁置 - 待 X 决定>

## 行动项

| 谁 | 做什么 | 何时 |
|----|-------|------|
| A  | ... | YYYY-MM-DD |

## 讨论要点

- ...
```

## 跟其他 skill 协作

- 用户描述了一个**重复**的文档生成模式 → 提议用 `cherry-skill-marketplace` 把它做成专属 skill（如团队的"周报"格式）
- 内容涉及 Cherry Studio 产品 → 先查 `cherry-assistant-guide` 拿权威信息
- 提交 Issue / 反馈 → 走 `issue-reporter`

## 限制

我是 Cherry Studio 内置的**轻量**版本。复杂场景（多文档关联 / 大型 spec / 合规公文 / 多语言并行）建议从 marketplace 找重型 skill：

- `enterprise-prd` — 飞书文档迁移 + 白板图表
- `magazine-web-ppt` — 演讲风网页 PPT
- `prd-creator` — 社区版 GitHub issue 双语 PRD

用 `cherry-skill-marketplace` 搜一下。
