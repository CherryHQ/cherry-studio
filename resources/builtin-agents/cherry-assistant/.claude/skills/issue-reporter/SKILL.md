---
name: issue-reporter
description: 帮助用户提交 Bug Report 或 Feature Request。支持 GitHub Issue（有账户）和本地存档（无账户）两种模式。当诊断发现是代码 Bug 时主动提议，或当用户说"帮我提 issue"、"这是个 bug"、"我想要这个功能"、"submit a bug"、"feature request"时触发。
---

# Issue Reporter

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
