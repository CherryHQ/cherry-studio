# Agent Note: 隔离开发配置保留默认协议处理程序

Status: implemented

[English](2026-11-07-isolated-profile-protocol-handler.md) | 中文

## Problem

设置了 `CS_DEV_PROFILE_ROOT` 的 E2E 实例仍会将自己注册为 `cherrystudio://` 的系统默认处理程序。删除临时运行时后，链接可能继续指向已删除的应用。仅隔离文件系统并不能保护用户的协议关联。

## Decision

存在经过验证的开发配置根目录时，`ProtocolService` 跳过默认处理程序注册和 AppImage 桌面入口设置。URL 监听器、启动参数和第二实例路由保持可用。打包应用忽略这一开发环境覆盖设置，保留正常的协议注册行为。

## Alternatives considered

每次运行前后保存并恢复处理程序，无法避免测试期间的干扰，还可能覆盖用户同时做出的修改。完全移除 URL 处理则会阻止对隔离实例进行显式深链验证。

## Consequences

由系统打开的链接继续使用用户安装的应用。隔离开发实例通过显式启动参数或事件接收深链，不接管全局协议。此修复不会自动更改已有的默认关联。

## Verification

- Regression — `ProtocolService.test.ts`：两种隔离启动方式在修复前都会覆盖预设的已安装处理程序，修复后保留该处理程序，同时启动深链仍能进入导航。
- Regression — `pnpm exec vitest run --project main src/main/services/protocol/__tests__/ProtocolService.test.ts src/main/core/paths/__tests__/constants.test.ts`：46 项通过，覆盖正常注册参数及打包应用、配置根目录的验证。
