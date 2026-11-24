# Agent Note: 最低 Windows 版本约定

Status: implemented

[English](2026-11-24-windows-minimum-version.md) | 中文

## Problem

使用较旧 Windows 硬件的用户无法从下载与安装流程中判断 Cherry Studio 是否支持 Windows 7。有用户通过第三方兼容层启动应用并遇到未明确的问题，看起来像是官方支持的行为。安装指引、启动路径、更新检查和系统要求文档中都没有权威的最低 Windows 版本约定（issue #20218）。

## Decision

受支持的最低版本为 Windows 10 1809（内部版本 17763，64 位 x64/ARM64）或更高版本（含 Windows 11）。Windows 7、8、8.1 不受支持，通过第三方兼容层启动也不属于官方支持。约定由四处共用同一真相来源 `src/shared/utils/osSupport.ts` 中的 `isSupportedWindowsRelease` 来执行：

- NSIS 安装程序在 `customInit` 中新增 `checkWindowsVersion` 步骤，读取 `CurrentMajorVersionNumber`/`CurrentBuildNumber`，在安装应用之前以中英双语提示中止安装。`preInit` 会保存模板创建的初始目录，中止路径仅对该目录做尽力而为的空目录清理（先切走工作目录），绝不删除 `initMultiUser` 选定的最终目录；由于模板在任何自定义钩子之前就已执行 `SetOutPath $INSTDIR`，完美无残留的中止是不可能的。
- 主进程新增同步 preboot 门禁 `src/main/core/preboot/osSupportGate.ts` 中的 `runOsSupportGate`，在 `resolveUserDataLocation()` 之前运行。`main.ts` 首先导入 `osSupportEarlyGate`，使门禁在任何 profile 相关导入（`bootConfig`/`LoggerService`）求值之前就在模块求值期执行。版本过低时显示中英双语错误对话框，不依赖 i18n 目录（通过 `app.getPreferredSystemLanguages()` 在 pre-ready 阶段安全获取语言，仅用 console + dialog，不写文件日志），然后以退出码 1 退出，不触碰用户数据与 `%APPDATA%/<App>/logs`。
- `AppUpdaterService` 在不受支持的 Windows 版本上跳过所有更新检查路径（`performUpdateCheck`、`queryUpdateAvailability`、`getLatestReleaseNotes`），按已是最新版本上报，并发送 `X-OS-Release` 请求头，便于服务端未来按系统版本过滤。`artifact-build-completed.js` 将 `minimumSystemVersion: 10.0.17763` 写在更新 manifest 根节点（`updateInfo` 之外同时写 `releaseInfo`，因为差分包会把 `updateInfo` 复制到 `files[0]` 而旧版 updater 会忽略），使未带门禁的老客户端收不到首个带门禁的版本。
- 安装文档与常见问题以中英双语声明同一最低版本，说明兼容层启动不属于官方支持，并将存档的 GitHub Releases 标记为仅供参考，不再提供支持与安全更新。

## Alternatives considered

- 更高的最低版本（例如 Windows 10 22H2）：未采用，因为 Electron 23+ 仅要求 Windows 10+，1809 在保持单一构建线的前提下覆盖最多受支持设备。
- 仅在启动时拦截而不检查安装程序：未采用，因为安装程序不应在永远无法运行的机器上落盘文件。
- 对不兼容的更新仅警告仍提供：未采用，因为静默保持“已是最新”无破坏性，且与启动拒绝一致。

## Consequences

Windows 7/8/8.1 设备在安装时、启动时以及（以不再推送的方式）在更新时都会收到明确的停止并解释提示，且不会变更任何用户数据。受支持的设备不受影响；更新请求现在携带系统版本，便于未来服务端过滤。外部下载页文案位于 website 仓库，仍需在该处同步更新。

## Verification

- Regression — `pnpm vitest run --project shared src/shared/utils/__tests__/osSupport.test.ts`：17 项测试通过，覆盖 17763 边界、旧版 NT 6.x 拒绝以及非 Windows 放行。
- Regression — `pnpm vitest run --project main src/main/core/preboot/__tests__/osSupportGate.test.ts src/main/services/__tests__/AppUpdaterService.osSupport.test.ts src/main/services/__tests__/AppUpdaterService.test.ts src/main/services/__tests__/AppUpdaterService.scheduler.test.ts src/main/services/__tests__/AppUpdaterService.notAvailable.test.ts`：68 项测试通过，包括 Win7 在触碰用户数据之前被拦截以及更新源被抑制。
- Regression — `pnpm exec tsx scripts/i18n-check.ts`：校验通过，无 `dialog.os_unsupported` 目录键（门禁使用内联双语，以保持 unused 检查常绿）。
- Regression — `pnpm exec tsx scripts/i18n-check-unused.ts --fail-on-unused`：主进程零未使用键通过；renderer 退役 prompt 键归属 main（已在上游 #25271 修复）。
- Regression — 对所有改动的源码与测试文件运行 `pnpm run typecheck:node`、eslint、oxlint、oxfmt：干净。
- Regression — `pnpm exec tsx scripts/docsGovernance/check-doc-links.ts`：全部 912 个 markdown 文件链接正常，包括新增的英文安装页面。
