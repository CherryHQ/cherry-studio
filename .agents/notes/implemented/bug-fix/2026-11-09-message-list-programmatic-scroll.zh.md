# Agent Note: 由 Virtua 执行消息列表的底部滚动

Status: implemented

[English](2026-11-09-message-list-programmatic-scroll.md) | 中文

## Problem

PR #14997 引入的 Virtua 接入通过 DOM 的估算 `scrollHeight` 写入 `scrollTop`，以跟随新消息。追加尚未测量的行可能越过最终底部。Virtua 将该写入视为普通滚动，丢弃滚动方向后方的缓冲区，卸载历史消息，再在滚动结束时恢复。这会丢失局部展开状态并重新执行代码渲染；消息 memo 无法保留已卸载的实例。

## Decision

按照 Virtua 官方聊天示例，使用 `VirtualizerHandle.scrollToIndex(lastIndex, { align: 'end' })` 跟随底部，由 Virtua 管理程序化滚动和待完成的测量校正。保留现有跟随/阅读所有权及原生几何检查。将 Virtua 从 0.49.1 升级到 0.54.2，不使用依赖补丁。

## Alternatives considered

- 仅升级：未修改的 0.54.2 仍会复现直接滚动导致的状态丢失。
- 修改库以保留两侧缓冲区：能掩盖现象，但应用仍绕过程序化滚动 API。
- 保留全部历史消息挂载或增加 memo：均未解决滚动所有权使用错误。

## Consequences

首页和智能体列表共享修正后的调用。Virtua 保留原有的有界虚拟化和缓冲策略。用户滚动、阅读锚点、显式导航动画及选择保留继续由各自现有模块管理。

## Verification

- Regression — `chatVirtualizerRuntime.integration.test.tsx` 使用真实 runtime 和 Virtua，验证追加一轮消息并完成底部测量跟随后，历史消息仍保持展开。恢复旧的直接滚动会将其重置为折叠。
- Electron — 在未打补丁的 0.54.2 上，通过五组对照区分直接 DOM 滚动和官方 API，并分别使用固定及自动估算。两组官方 API 均保留全部八个历史实例；仅修改估算方式不能解决直接滚动的问题。
- Electron — 应用修复后，在已有四轮对话中发送消息并接收四段模拟流式回复，保留全部八个原有消息 DOM 实例，历史 `MessageItem` 卸载次数为零。
