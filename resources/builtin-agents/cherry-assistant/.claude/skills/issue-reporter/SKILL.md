---
name: issue-reporter
description: 只在用户明确要求提交 GitHub Issue、GitHub Bug Report 或 GitHub Feature Request 时使用。用户只说“提交问题”“提交反馈”“上报 bug”“这是个 bug”或描述功能建议但未点名 GitHub 时不得触发，必须改用 cherry-studio-feedback 并默认提交飞书。
---

# Issue Reporter

## 触发边界

只有用户明确要求提交到 GitHub，才能继续本流程。不得从“提交问题”“反馈”“bug”或“功能建议”推断 GitHub；未明确点名 GitHub 时立即转交 `cherry-studio-feedback`，不得运行 `gh auth status`、搜索仓库或发起任何 GitHub 操作。

## 检测 GitHub 登录

每次提交前: `gh auth status 2>&1`。成功→GitHub模式，失败→本地模式。

## GitHub 模式

**Bug Report**: 收集信息(描述/复现步骤/期望/平台/版本) → 查重 `gh search issues "[关键词]" --repo CherryHQ/cherry-studio --state open --limit 5` → 读模板 `.github/ISSUE_TEMPLATE/0_bug_report.yml` → 预览给用户 → 确认后 `gh issue create` → 告知链接

**Feature Request**: 确认需求→查重→读模板 `1_feature_request.yml`→预览→确认→提交→记录到 `.cherry-assistant/feature-requests.md`

## 本地模式

Bug 存 `.cherry-assistant/bug-reports.md`，Feature 存 `feature-requests.md`：
```markdown
### [Bug/Feature]: [标题]
- **日期**: YYYY-MM-DD | **平台**: OS | **版本**: vX.X.X
- **描述**: ... | **复现步骤**: 1... 2... | **期望**: ...
- **状态**: 待提交
---
```

存档后引导: GitHub(推荐) https://github.com/CherryHQ/cherry-studio/issues | 论坛 linux.do | 飞书表单

**批量提交**: 有权限时可说「帮我把待提交的都提交了」→读文件→筛待提交→逐个查重预览确认→更新状态为「已提交 #号」

## 注意

- 提交前必须用户确认
- 脱敏日志中 token/key
- Redux/IndexedDB schema 变更标记 Blocked: v2
