# Agent Note: 发布 GitCode 附件前验证镜像标签

Status: implemented

[English](2026-11-27-gitcode-release-tag-readiness.md) | 中文

## 问题

GitHub 可以在 GitCode 拉取标签之前发布版本。v2.2.4 的标签及其提交尚未进入镜像时，GitCode 发行版写入返回 HTTP 400。创建请求使用的 `main` 可能指向与构建不同的提交。

## 决策

[GitCode 同步脚本](../../../../scripts/release/sync-gitcode.sh) 在使用 COS 产物时等待对应的发布标签。只有标签解析到 COS 清单记录的构建 SHA，才写入发行版信息和附件。缺少标签时重试，SHA 不一致时停止，超时则输出当前 Pull 镜像状态。

## 考虑过的替代方案

- GitCode 拒绝向 Pull 镜像直接推送。其公开镜像接口用于读取配置和状态。网页控制台可以触发拉取，启用覆盖分叉分支后，拉取可能强制更新已分叉的分支。

## 影响

镜像有延迟时，同一次运行仍可等待标签到位。需要人工恢复时，标签到位后可通过 `sync-only` 复用现有 COS 清单。

## 验证

- Regression — `pnpm test:scripts scripts/__tests__/gitcode-sync.test.ts scripts/__tests__/release-workflow.test.ts`：标签延迟时，解析到构建 SHA 后才允许写入；标签缺失或 SHA 不一致时，GitCode 发行版数据保持原样。
