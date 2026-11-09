# Agent Note: Windows 划词助手的系统截图宿主排除策略

Status: proposed

[English](2026-11-01-windows-selection-system-screenshot.md) | 中文

## 问题

#23330 的报告者观察到启停 A/B 差异：启用划词助手、使用 Selected 模式且应用筛选关闭时，复制并粘贴 Cherry 回复后再用 Win+Shift+S 截图，截图无法粘贴；关闭助手后，截图粘贴恢复。

源码已证实的事实：应用筛选关闭对应 `filter_mode='default'`。在 Selected 模式下，`SelectionService.setHookGlobalFilterMode` 把 default 转为预置排除名单，并在用户选择 blacklist 时合并该名单。Windows 的 Screenshot 组已排除 `snipaste.exe`、`pixpin.exe` 和 `sharex.exe`，但缺少 `snippingtool.exe` 与 `screenclippinghost.exe`。依赖的 Windows 源码在命中全局排除项时，会在 UIA、MSAA 或剪贴板取词之前退出。

尚未确认的 Windows 路径：依赖的源码在部分取词条件与时序下允许发生剪贴板竞争，但本轮没有在 Windows 复现报告，也未确定实际的前台进程、光标、剪贴板所有者、恢复或 hook 路径。仅凭源码不能认定底层根因。

## 提案

将完整小写可执行文件 basename `snippingtool.exe` 和 `screenclippinghost.exe` 追加到 `SELECTION_PREDEFINED_BLACKLIST.WINDOWS`，保留现有三项截图工具条目。复用现有 Selected/default 与 Selected/blacklist 接线，不改变偏好。Selected/whitelist 与非 Selected 模式不会从这份预置名单获得新增保护。

保护的前提是取词目标解析为这两个进程之一。hook 在处理手势时调用 `GetForegroundWindow()`；如果遮罩已经关闭、焦点回到其他应用，排除项可能无法命中。这是整应用排除，也包括这两个应用内编辑器/OCR 文本的自动划词。native 匹配器把名称转为小写后做子串匹配；完整 basename 缩小了条目范围，但并未让匹配变成严格相等。

## 考虑过的替代方案

- 只对这两个应用关闭剪贴板回退：`setClipboardMode(EXCLUDE_LIST, ...)` 确实存在，可以保留 UIA/MSAA 划词。但它仍判断同一个由前台窗口推导出的进程名，无法补上目标识别缺口；仓库已经拥有 Screenshot 排除策略，再接入一套名单与模式生命周期没有必要。
- 截图期间临时禁用/启用剪贴板取词：当前没有已接入且可靠的截图会话开始/结束信号。只监听 Win+Shift+S 会漏掉其他入口，还需处理取消与重入。请求入队时会快照配置，因此事件之后切换开关无法追回在途请求。
- 修改 `SELECTION_FINETUNED_LIST` 的两个名单：`EXCLUDE_CLIPBOARD_CURSOR_DETECT` 让应用豁免光标检查，可能开启原本会被自定义截图光标拦住的回退，方向相反。`INCLUDE_CLIPBOARD_DELAY_READ` 只改变复制时序，仍保留剪贴板清空与恢复，没有保护并发写入的契约。
- 修改 native 源码或升级依赖：加载器使用 native 二进制；`electron-builder.yml` 丢弃 `selection-hook/build/**` 与 `selection-hook/src`，保留预编译产物。analysis/advisor 的 registry 查询记录 latest 仍为 2.1.2，与仓库 pin 一致。单改源码无法交付改变后的二进制；native 修复需要验证 Windows 构建并调整发行链，超出这次候选补丁的范围。

## 验收标准

- AC1 — 在报告的 Selected + 应用筛选关闭配置下，复制并粘贴回复后再用 Win+Shift+S 截图，截图能够正常粘贴。（verification: Windows 人工验收，待做）
- AC2 — 截图前后，浏览器和 Word 等普通应用的划词与划词工具栏继续正常工作。（verification: Windows 人工验收，待做）
- AC3 — 配置单测覆盖系统截图宿主的预置排除策略，并防止现有第三方截图工具条目回归。（verification: macOS 单测 `src/main/services/selection/__tests__/selectionConfig.test.ts`）

实现 worker 负责 macOS 配置单测、消费者测试和静态检查；Windows 验证者负责尚未完成的人工验收。名单成员断言不能证明 native 过滤、截图粘贴或已安装第三方工具的实际行为。

## 风险

- 光标启发式、非文本选择检查或 UIA/MSAA 成功取词，可能本就会阻止剪贴板回退。剪贴板竞争仍只是对报告现象尚未确认的解释。
- 处理时的前台窗口可能属于其他应用，进程名解析可能失败，且这两个条目不会取消已经入队的取词请求。
- 这两个条目没有为其他截图宿主和并发剪贴板写入者提供通用保护。
- 两个被排除应用内编辑器/OCR 文本的自动划词也会被整体禁用。
- Windows 与 Snipping Tool 版本可能改变进程宿主与时序；本轮没有验证报告中的 Windows build。

## 验证

- 在 macOS 上对尚未改动的产品文件运行配置单测：2 failed / 3 passed，仅缺少两个系统宿主。追加条目后，同一命令的 5 项测试全部通过。
- 现有 `SelectionService.test.ts` 与 `SelectionService.voice.test.ts` 消费者测试通过：2 个文件、14 项测试。其 mock 平台不能验证 Windows 截图行为。
- 要求的 node 类型检查耗尽默认堆内存（退出码 134）。使用 8 GB 堆重跑后，仅报告 `tests/helpers/piGateway.ts:25` 的基线 TS2307：缺少 `@cherrystudio/agent-runtime-pi` 模块（退出码 2）。
- 定向 Oxlint、ESLint、Oxfmt 与 `git diff --check` 均通过。这份 Note 的三件套已落地，仓库 Agent Note 格式与双语配对闸门对本 Note 均通过。

Windows 验收待做；底层剪贴板竞争尚未确认。Windows acceptance pending; the underlying clipboard competition is not confirmed.
