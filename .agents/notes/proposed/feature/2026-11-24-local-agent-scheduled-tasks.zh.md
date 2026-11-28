# Agent Note: 本地智能体定时任务

Status: proposed

[English](2026-11-24-local-agent-scheduled-tasks.md) | 中文

## Problem

定时任务选择器和创建服务会拒绝所有本地智能体。运行时已把无人值守标记传给 driver，本地连接还未处理该标记。

## Proposal

在现有调度器和执行记录中支持已配置的本地智能体。Codex 使用只读沙箱并关闭原生集成。Claude SDK 只暴露读取工具，关闭环境设置和 MCP。宿主传递已配置的服务地址、模型和凭据。ACP 宿主将读文件限制在工作目录，拒绝写文件、终端、审批和询问请求。交互执行和无人值守执行切换时重建连接。复用已有数据库字段。

本地智能体的启用状态与活跃任务的暂停在同一事务内更新。保留手动暂停的任务，智能体恢复可用后沿用现有的错过运行处理规则。ACP 达到输出或请求上限时，运行记为失败，部分回复留在对话中。会话忙碌时记为已跳过，无运行结果通知。已有定时通知通过去重键找回对应的运行。

## Alternatives considered

单独调用 CLI 会重复实现会话、取消和结果处理。继承交互权限会让已保存的会话设置扩大重复任务的执行范围。

## Acceptance criteria

- AC1 — 已启用的本地智能体可以创建定时任务，已禁用的智能体会被拒绝。（verification: service and renderer; owner: implementation）
- AC2 — 各本地协议都能启动和恢复无人值守执行，执行时忽略互动会话的权限设置。由宿主处理的交互请求会直接结束。（verification: protocol fixture; owner: implementation）
- AC3 — 定时执行将回复记录到任务会话，取消和执行异常都会结束并显示在执行记录中。（verification: Electron and service; owner: implementation）

## Risks

任务触发时需要可用且已认证的本地 CLI。ACP 智能体可以在自己的进程内使用工具，这些工具遵循 CLI 原生权限配置。
