# Agent Note: 由 Virtua 执行消息列表的底部滚动

Status: implemented

[English](2026-11-09-message-list-programmatic-scroll.md) | 中文

## Problem

PR #14997 引入的 Virtua 接入通过 DOM 的估算 `scrollHeight` 写入 `scrollTop`，以跟随新消息。追加尚未测量的行可能越过最终底部。Virtua 将该写入视为普通滚动，丢弃滚动方向后方的缓冲区，卸载历史消息，再在滚动结束时恢复。这会丢失局部展开状态并重新执行代码渲染；消息 memo 无法保留已卸载的实例。

## Decision

按照 Virtua 官方聊天示例，使用 `VirtualizerHandle.scrollToIndex(lastIndex, { align: 'end' })` 跟随底部，由 Virtua 管理程序化滚动和待完成的测量校正。保留现有跟随/阅读所有权及原生几何检查。将 Virtua 从 0.49.1 升级到 0.54.2，不使用依赖补丁。

从历史位置发送消息、点击输入框上方按钮等显式返回底部操作，共用同一个调用并启用 `smooth: true`。动画期间，自动跟随不得发起瞬时滚动。动画结束后，通过下一次原生平滑滚动校正新增内容，再恢复普通跟随。滚轮、键盘或滚动条输入会先取消待完成的动画，再将视口交还阅读模式。

## Alternatives considered

- 仅升级：未修改的 0.54.2 仍会复现直接滚动导致的状态丢失。
- 修改库以保留两侧缓冲区：能掩盖现象，但应用仍绕过程序化滚动 API。
- 保留全部历史消息挂载或增加 memo：均未解决滚动所有权使用错误。
- 通过 DOM 偏移量动画返回底部：会绕过 Virtua 对待完成测量的处理，因此使用其内置平滑选项。

## Consequences

首页和智能体列表共享修正后的调用。Virtua 保留原有的有界虚拟化和缓冲策略。用户滚动、阅读锚点、显式导航动画及选择保留继续由各自现有模块管理。

## Verification

- Regression — `chatVirtualizerRuntime.integration.test.tsx` 使用真实 runtime 和 Virtua，验证追加一轮消息并完成底部测量跟随后，历史消息仍保持展开。恢复旧的直接滚动会将其重置为折叠。
- Electron — 在未打补丁的 0.54.2 上，通过五组对照区分直接 DOM 滚动和官方 API，并分别使用固定及自动估算。两组官方 API 均保留全部八个历史实例；仅修改估算方式不能解决直接滚动的问题。
- Electron — 应用修复后，在已有四轮对话中发送消息并接收四段模拟流式回复，保留全部八个原有消息 DOM 实例，历史 `MessageItem` 卸载次数为零。
- Regression — `chatVirtualizerRuntime.test.tsx` 验证返回底部不会立即跳转，内容增长不会打断动画，到达新底部后恢复跟随，用户中断后保持阅读模式。
- Electron — 从历史位置点击原生按钮、按 Enter 发送消息，均经过中间滚动位置到达底部；动画期间向上滚轮会取消动画并停留在历史位置。三个场景均在隔离开发配置中录制。
