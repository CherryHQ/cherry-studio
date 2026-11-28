# Agent Note: 每次文件就地重命名只结束一次

Status: implemented

[English](2026-11-27-inline-rename-single-submit.md) | 中文

## 问题

按 Enter 提交时，编辑器可能仍挂载并等待文件操作。随后失焦可能再次提交同一名称。按 Esc 取消后失焦也可能触发提交。

## 决策

就地输入框在调用回调前先记录终止动作。Enter、Esc 和失焦共用这一判断。

## 考虑过的替代方案

- 只拦截请求仍可能让已取消的输入框在失焦时触发确认。

## 影响

每次挂载的重命名输入框只发出一次确认或取消。输入法组合期间的 Enter 仍用于编辑。

## 验证

- Regression — `src/renderer/pages/files/__tests__/InlineRename.test.tsx`：Enter 后失焦只提交一次，Esc 后失焦不提交。
