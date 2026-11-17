# Agent Note: 开发模式启动前重启时避免不可用的弹窗

Status: implemented

[English](2026-11-07-preboot-development-relaunch.md) | 中文

## 问题

MP-121 已完成测试配置目录的清除，但在启动前阶段再次重启时失败。Application.relaunch 在 Electron 就绪前无条件调用 showMessageBoxSync 显示开发模式提示。

## 决策

仅在 app.isReady() 后显示手动重启弹窗；否则记录现有警告并成功退出。分支 E2E 显式验证这次启动前阶段的成功退出，再启动一次全新配置。

## 考虑过的替代方案

等待就绪会让配置初始化与启动前操作交叠。忽略所有启动失败则可能掩盖真正的崩溃。

## 影响

打包应用的重启行为不变。开发模式仍需手动重启；控制器仅接受零退出码，并验证重置标记及测试文件已经消失。

## 验证

- Regression — `Application.relaunch.test.ts` 复现 Electron 在就绪前拒绝弹窗的行为，并验证就绪前后均成功退出。就绪前分支在修复前失败。
