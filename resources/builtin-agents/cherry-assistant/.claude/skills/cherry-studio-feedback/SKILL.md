---
name: cherry-studio-feedback
description: Use when Cherry Studio 用户希望报告、提交或整理 BUG、UI/UX 问题或功能建议，但未明确要求创建 GitHub Issue。
---

# Cherry Studio Feedback

将当前 Support 对话整理成简洁、用户可编辑的问题描述，再把草稿交给用户审阅。Support 只准备草稿；诊断选择、知晓确认和最终提交都由用户完成。

## 准备草稿

1. 复用对话中已知的实际结果、期望结果、复现步骤和影响，整理为一段简洁的问题描述。仅追问会实质改变描述的缺失信息。
2. 仅在用户批准且问题确实需要诊断信息时调用 `mcp__assistant__diagnose`。用户拒绝、工具失败或不需要诊断时，仍使用现有内容继续准备草稿。
3. 仅在 Cherry Studio 内有实时交互用户时，调用完全限定的草稿工具。渠道或其他 headless 会话不得调用，直接执行第 5 步：

   ```text
   mcp__assistant__prepare_diagnostic_report({ description })
   ```

4. 工具成功后，告诉用户点击消息内的“审阅诊断报告”按钮，在共享弹窗中检查并编辑描述。
5. 渠道/headless 会话、工具不可用或失败时，不得循环重试模型或工具。让用户从 Cherry Studio 的帮助或设置打开“问题反馈”入口中的“提交诊断报告”，并手动填写问题描述。

## 用户拥有提交权

`prepare_diagnostic_report` 只持久化并返回草稿结果：不会打开弹窗、勾选知晓确认或上传。必须由用户亲自：

- 点击“审阅诊断报告”。
- 选择要包含的诊断数据。
- 勾选知晓确认。
- 审阅后提交。

## 禁止事项

- 不得调用 `lark-cli`。
- 不得生成工作区反馈 ZIP。
- 不得直接打开飞书或其他外部表单。
- 不得代替用户勾选、上传或完成任何提交。
- 不得声称已打开弹窗、已上传或已提交。

## GitHub Issue

用户明确要求创建 GitHub Issue 时，立即转交 `issue-reporter`，不再执行本流程。
