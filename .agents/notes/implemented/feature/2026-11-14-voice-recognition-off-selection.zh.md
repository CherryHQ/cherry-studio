# Agent Note: 语音识别关闭选项

Status: implemented

[English](2026-11-14-voice-recognition-off-selection.md) | 中文

## Problem

本地听写需要明确的关闭状态，同时 Automatic 保留既有语义。改动前压制输入只能靠三步绕行（取消固定 composer 工具、关闭鼠标长按、清空两个热键），漏掉任何一步仍可能弹出录音界面，在共享屏幕时是隐私风险。

## Decision

在 `feature.voice.recognition.model_id` 中持久化 `off`。仅 renderer 解释它；空字符串仍表示 Automatic，未知非空模型 ID 仍视为不支持。设置中的 Off 位于 Automatic 前，禁用识别语言和快捷键控件但不清空已存值。下载操作仅导航。

一个工具函数和一个派生 hook 隐藏 composer、启动面板、快捷助手、笔记和翻译中的听写入口，并禁用键盘与鼠标手势。输入、发送和麦克风测试保持可用。轻量窗口预加载模型偏好。

`DictationService` 在语音初始化和录音准入前拦截每次运行，并持有随生命周期释放的偏好订阅。准入时从主进程读取模型 ID 而不是 renderer 缓存；读取不到时阻止运行，而不是回落到宽松的默认值。Off 在异步取消待启动、活动或恢复状态前，同步失效当前 generation。取消丢弃音频而不转写，放弃尚未返回的麦克风采集，也不会取消重新开启后的新运行。

## Alternatives considered

- 新增偏好键：为一个枚举式的选择引入不必要的 schema、默认值与 seed 工作。
- 复用空字符串：与 Automatic 冲突，后者会自行解析出已安装引擎。
- 隐藏按钮或停止录音：陈旧操作仍可录音，停止还可能转写已录音频。

## Consequences

语言和快捷键值在 Off 后保留；选择引擎恢复听写。模型下拉仍是唯一控件，因此不存在第二个状态源。旧版本会把 `off` 读成不支持的模型 ID，而不是关闭状态。别的窗口切到 Off 时，已经打开的听写子菜单不会被强制关闭；它的条目只作用于 Off 已取消的那次运行，因此在重新开启听写之前无法据此开始采集。产品形态由 #24552 的分诊决策卡确定；本次实现不再单独开 Spec PR。

## Verification

- Regression — `VoiceSettings.test.tsx` 与 `DictationShortcutSettings.test.tsx`：Off 在重新挂载后保留、选择引擎恢复控件、语言与快捷键值保留、下载入口只导航。
- Regression — composer、统一面板、笔记、翻译、快捷助手和手势测试：Off 时不渲染任何听写入口，重新开启后入口与快捷键恢复，常规输入与发送保持可用。
- Regression — `VoiceService.test.ts`、`DictationService.test.ts` 与 `DictationService.streaming.test.ts`：哨兵解码为无偏好、Off 时不申请准入也不采集、活动录音被取消且不转写、旧读取不会杀死重新开启后的新运行。
- Regression — 定向 renderer 测试保留自动解析、未知模型处理与麦克风测试。
