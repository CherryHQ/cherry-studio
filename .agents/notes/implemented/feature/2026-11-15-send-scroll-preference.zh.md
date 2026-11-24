# Agent Note: 发送时是否回到底部改为偏好开关

Status: implemented

[English](2026-11-15-send-scroll-preference.md) | 中文

## Problem

打开一轮对话时，消息列表过去总是被强制移动到最新消息：`useChatRuntimeState.sendMessage` 在 `send()` 返回成功后调用列表暴露的 `scrollToBottom()`。用户向上翻阅历史后再发一条消息，阅读位置就丢了，这正是 #24594 描述的打断。该行为没有面向用户的开关，不改代码就无法退出。

仓库里另有一条 #23531 在跟进「发送后跟随到底部」，本次改动不得替换、重复实现或回退那条工作。

## Decision

`chat.message.scroll_to_bottom_on_send` 是一个布尔型桌面偏好，定义在 `scripts/data-classify/data/target-key-definitions.json`，由生成器写入 `src/shared/data/preference/preferenceSchemas.ts`，默认值 `true`。默认值让所有既有配置保持今天的行为：不做迁移、升级不写盘、从不打开设置的用户完全无感。

这个偏好只 gate 一个调用点——`useChatRuntimeState.sendMessage` 中「`send()` 成功后那次显式 `scrollToBottom()`」。关闭后，发送仍然正常开启这一轮、仍然返回 `sent: true`、流式照常，只是不再强制回到最新消息，列表保留读者的位置。

滚动位置的所有权其余部分不变：公共 `scrollToBottom` helper、`useChatWriteActions`（`startNewContext`、`forkAndResend`、`resend`）、手动「回到底部」按钮、消息定位、会话初始位置恢复，以及虚拟列表自身的流式跟随。偏好关闭时，本来就停在底部跟随的用户仍然继续跟随流式内容；开关只是去掉「发送带来的抢占」，不冻结视口，也不取得阅读所有权。

设置项以「外观 → 消息」下的开关呈现，行 id（`setting-appearance-scroll-to-bottom-on-send`）注册进设置搜索索引，十七个语言都提供标签与说明的真实翻译。

## Alternatives considered

- 只在写动作层（`useChatWriteActions`）分支被否决：那里同时覆盖重发、fork 与新上下文的发送，这些路径回到底部仍然合理，也不属于用户报告的打断。
- 用「阅读锁」冻结视口被否决：那是更大的行为改动，会连「本来就在底部」用户的流式跟随一起停掉，还需要自己的所有权模型。
- 复用 #23531 的跟随状态作为开关被否决：那条工作决定的是流式过程中列表跟到哪里，而不是「发送能否抢走位置」。
- 增加按会话或按助手维度的覆盖被否决：与报告的场景相比没有必要，打断来自一个全局的阅读习惯。

## Consequences

偏好关闭时发送后不会自动露出新追加的那一轮，用户要靠手动「回到底部」或自己滚动去找——这正是有意的取舍。该偏好与其它 `chat.message.*` 键一样存储，重启和切换配置后保持，不需要额外持久化代码。由于 gate 落在共享发送路径上，排队与 drain 的轮次遵循同一规则；这是刻意的，drain 出来的仍然是用户发起的发送。

## Verification

- Regression — `src/renderer/pages/home/__tests__/useChatRuntimeState.test.tsx`：偏好开启时发送成功调用一次列表 `scrollToBottom`；关闭时零次；发送失败或抛错时从不滚动。
- Regression — `src/renderer/components/chat/settings/__tests__/ChatPreferenceSections.test.tsx`：开关反映已存值，切换时经偏好 setter 持久化。
- Regression — `src/renderer/pages/settings/settingsSearch/__tests__/settingsSearchIndex.test.ts`：新条目可被搜索到，并解析到「外观」里对应的行。
- Electron — `tests/e2e/smoke/sendScrollPreference.test.ts`：真实 Electron 覆盖默认「发送后回到最新」、关闭后发送与流式期间的阅读锚点、Enter 发送多行草稿、本就在底部时继续跟随、排队保持与 drain、重新打开开关、同 profile 重启后保持，以及开关关闭时的手动回到底部。
