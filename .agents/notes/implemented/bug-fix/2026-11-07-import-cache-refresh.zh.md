# Agent Note: 刷新已挂载列表中的导入对话

Status: implemented

[English](2026-11-07-import-cache-refresh.md) | 中文

## 问题

MP-120 已将两段 ChatGPT 对话成功导入 SQLite，但返回聊天页后仍显示缓存中的助手列表。ImportService 直接通过 DataApi 写入，没有经过通常负责刷新列表的 mutation hook。

## 决策

导入成功后、关闭导入弹窗前，使助手和话题集合的查询缓存失效。导入消息及回滚行为保持不变。

## 考虑过的替代方案

重新加载窗口会丢失其他界面状态。将服务改为 React hook 会无谓扩大修复范围。

## 影响

已经挂载的列表会重新获取新导入的记录。失败的导入不会提示成功完成。

## 验证

- Regression — `ImportPopup.test.tsx` 使用真实查询 hook 和隔离的 SWR 缓存：完成导入后，无需重新加载即可更新两个可见列表；移除缓存失效操作后该测试失败。
