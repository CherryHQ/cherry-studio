# Agent Note: 通过 Sentry 上传原生崩溃转储

Status: implemented

[English](2026-11-15-sentry-native-crashes.md) | 中文

## 问题

Crashpad 将原生崩溃转储保存在本地，但 Sentry 未启用原生崩溃上报，诊断包也只包含转储清单。因此，主进程崩溃可能没有远端崩溃堆栈，尤其是用户没有提交诊断包时。

## 决策

在 `ErrorReportingService.onInit` 中安装现有 SDK 的 `sentryMinidumpIntegration`，等待其 `PreferenceService` 依赖就绪。保留早期的本地 Crashpad 收集。主进程转储在下次启动时上传；渲染进程和子进程转储在 SDK 观察到其终止时上传。事件处理和传输继续检查现有数据收集授权及当前隐私政策版本，不增加单独选项或提示。

## 考虑过的替代方案

- 在诊断包中增加转储附件仍依赖用户手动报告。
- 在 preboot 阶段安装集成，会在授权检查能读取偏好设置之前扫描并删除待上传转储，导致启动时的崩溃报告丢失。
- 使用 Electron 原生上传器会绕过现有 Sentry 事件和传输的授权检查。

## 影响

SDK 负责发现、解析、删除转储，并限制每次运行最多上传十份。二进制转储可能包含进程内存；JSON 事件脱敏不会清理其内容。开发模式、关闭数据收集或已接受的政策版本过期时，仍禁止上传。现有传输不会将失败的上传排队保存以供离线重试。

## 验证

- Regression — `pnpm test:main src/main/services/errorReporting/__tests__/sentry.test.ts src/main/services/errorReporting/__tests__/sentryLog.test.ts src/main/core/logger/__tests__/LoggerService.test.ts src/main/core/preboot/__tests__/crashTelemetry.test.ts --maxWorkers=1`：150 项测试通过，覆盖二进制 minidump envelope 的授权和撤销。
- Regression — macOS arm64 Electron 45.2.2 和 Sentry 7.18.0 测试程序：真实主进程崩溃生成的转储在 preboot 等待期间得到保留，偏好设置就绪后，生产上报服务通过真实 SDK 传输向本地 HTTP 接收端发送了 1,317,664 字节的 `event.minidump` 附件。事件为 native/fatal，带有 browser 进程标识和应用发布版本。测试程序隔离了偏好设置并禁止系统崩溃弹窗；未验证 Windows、完整打包应用启动及生产 Sentry 入库。
- Regression — 同一测试程序上传了 618,960 字节的渲染进程转储，服务重启后仍只保留一组原生崩溃监听器，关闭数据收集或已接受的政策版本过期时，均未发送恢复的转储。
