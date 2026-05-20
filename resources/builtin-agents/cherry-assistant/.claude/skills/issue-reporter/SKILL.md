---
name: issue-reporter
description: 帮助用户提交 Bug Report 或 Feature Request。三种路径：GitHub Issue（已登录 gh）、飞书反馈表单（GitHub 不通或不愿登录 gh）、本地存档（先放着稍后提交）。当诊断发现是代码 Bug 时主动提议，或当用户说"帮我提 issue"、"这是个 bug"、"我想要这个功能"、"提交反馈"、"submit a bug"、"feature request"时触发。
---

# Issue Reporter

## 选路决策

读 Current Environment 的 `## Network` 段 + 跑 `gh auth status 2>&1`，按下表选默认路径（用户始终可以指定其他路径）：

| github.com | gh 登录 | 默认路径 |
|------------|---------|---------|
| reachable | ✓ | **GitHub 直接提交** |
| reachable | ✗ | 提议登录 `gh`；不愿登录则**飞书引导** |
| unreachable | — | **飞书引导** |

任何路径下，用户可说"先放着"→ 走**本地存档**。

## 字段收集（所有路径共用）

收集这些字段，对齐 `.github/ISSUE_TEMPLATE/0_bug_report.yml`：

- **类型**：Bug / Feature Request
- **标题**：简短具体（不要"卡了"、"不工作"）
- **平台**：Windows / macOS / Linux
- **版本**：Cherry Studio vX.X.X（不知道→引导设置→关于查看）
- **描述**：发生了什么
- **复现步骤**：1. ... 2. ... 3. ...
- **期望行为**
- **相关日志**：跑 `mcp__assistant__diagnose(errors)` 取最近 ERROR/WARN，**脱敏 token/key/密码/邮箱/绝对路径**
- **附加上下文**（可选）

信息不全先问，不要硬塞 placeholder。

## 路径 A：GitHub 直接提交

1. 查重：`gh search issues "[关键词]" --repo CherryHQ/cherry-studio --state open --limit 5`，发现重复→给链接让用户去 +1
2. 读模板：`.github/ISSUE_TEMPLATE/0_bug_report.yml`（Bug）或 `1_feature_request.yml`（Feature）
3. 预览给用户 → 确认后 `gh issue create`
4. 告知 issue 链接 + 标号

## 路径 B：飞书引导（贴板就走）

1. 字段收集 + 脱敏（同上）
2. 预览给用户：「这是要提交的内容，确认提交吗？」
3. 用户确认后，**输出可直接复制粘贴的结构化文本**：

```
========== 复制以下内容到飞书反馈表单 ==========

【类型】Bug / Feature Request
【标题】<简短具体的标题>
【平台】Windows / macOS / Linux
【版本】Cherry Studio vX.X.X
【描述】
<问题描述>

【复现步骤】
1. ...
2. ...
3. ...

【期望行为】
<期望发生什么>

【实际行为】
<实际发生什么>

【相关日志（已脱敏）】
[YYYY-MM-DD HH:MM:SS] ERROR ...

【附加上下文】
<截图说明、特殊环境、参考链接等>

==========================================
```

4. 给链接 + 操作引导：

> 请打开飞书反馈表单：
> https://mcnnox2fhjfq.feishu.cn/share/base/form/shrcnkR1s45VDuFnV3GbD6VhnIJ
>
> 把上面【】里的内容按对应字段粘贴到表单中即可。表单里没有的字段（例如「附加上下文」如果飞书表单不收）可以放到「描述」末尾。

5. 同时存档到 `.cherry-assistant/feedback-archive.md`，标记 `状态: 飞书已引导`：

```markdown
### [Bug/Feature]: <标题>
- **日期**: YYYY-MM-DD | **平台**: OS | **版本**: vX.X.X
- **路径**: 飞书引导
- **状态**: 飞书已引导（用户已在 YYYY-MM-DD 收到表单链接）
- **描述**: ...
- **复现步骤**: 1... 2... 3...
- **期望**: ...
---
```

## 路径 C：本地存档（兜底）

完全不连网或用户说"先放着稍后提交"，写入：

- Bug → `.cherry-assistant/bug-reports.md`
- Feature → `.cherry-assistant/feature-requests.md`

格式：

```markdown
### [Bug/Feature]: <标题>
- **日期**: YYYY-MM-DD | **平台**: OS | **版本**: vX.X.X
- **状态**: 待提交
- **描述**: ...
- **复现步骤**: 1... 2... 3...
- **期望**: ...
---
```

存档完毕后告知反馈渠道：飞书表单（推荐 CN）/ GitHub Issues / Discord / 论坛 linux.do

## 批量后续提交

用户说「帮我把待提交的都提交了」时：

1. 读 `.cherry-assistant/bug-reports.md` 和 `feature-requests.md`
2. 筛 `状态: 待提交` 的条目
3. 按当前网络/登录状态走路径 A 或 B
4. 提交后更新状态：
   - GitHub 路径 → `状态: 已提交 #issue 号`
   - 飞书路径 → `状态: 飞书已引导（YYYY-MM-DD）`

## 注意

- **任何路径下提交前必须用户确认**——预览完整内容
- **脱敏**：日志/路径/截图描述里出现的 token/key/密码/邮箱/手机号/绝对路径要替换为 `<REDACTED>` 或 `~/...` 通配
- **Redux/IndexedDB schema 变更标记 `Blocked: v2`**——这类改动 main 分支不接受
- 一次只处理一条 Issue/Feature，避免上下文混乱
