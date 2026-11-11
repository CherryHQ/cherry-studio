# Agent Note：允许用户停止把技能导出到共享的外部技能目录

Status: implemented

[English](2026-11-11-external-skill-export-app-switch.md) | 中文

## Problem

Cherry Studio 会把内置技能和用户安装的技能镜像到 `~/.agents/skills` —— 其它 agent 工具读取的目录。产品里没有任何办法停止这次镜像。用户删除链接后，下一次 reconcile 它们又回来了；而完全不希望该目录被触碰的用户，连一个开关都没有。单技能的 `agent_global_skill.mirror_enabled` 列只能逐个关掉技能，想保持目录干净就得一个技能点一次，而且每新增一个内置技能都要重新关一次。

## Decision

新增应用级偏好 `agent.skills.external_export.enabled`（布尔，默认 `true`），它现在门控所有写入外部目录的路径。默认行为不变：全新安装仍然导出。

偏好关闭期间，主进程拒绝创建或恢复链接，移除本应用创建的链接，用户自己创建的条目一律不动。偏好重新打开时按每个技能保存的 `mirror_enabled` 恢复，因此单技能选择在应用级开关之间被保留，而不是被压平。技能详情页保留自己的勾选框，应用级关闭时它处于禁用状态并给出说明。

## Alternatives considered

直接删掉导出功能会破坏它存在的互操作目的。只保留单技能控制，用户就没有办法停止批量导出，而且新增的内置技能会不断重新出现。把应用级开关存进 SQLite 需要为偏好存储本来就能持久化的值做一次迁移。关闭时删掉整个目录，则会破坏其它工具或用户自己拥有的链接与文件。

## Consequences

安装后仍会写入 `~/.agents/skills`，直到有人关掉这个开关 —— 这是所报告问题剩下的一半：默认仍然导出，但它现在可见、也可撤回。开关关闭时，本应用拥有的链接消失，外部条目保留。如果在移除链接与更新目录行之间崩溃，没有需要修复的残留，因为 reconcile 只移除本应用能证明由自己创建的条目。旧版本创建的链接可通过目标路径识别为本应用所有，因此升级不会留下孤儿。

## Verification

- Regression — `src/main/ai/skills/__tests__/SkillService.test.ts` 的 "external export preference" 用例：下列五条路径在改动前失败、改动后通过；与该文件一起的聚焦主进程集合（6 个文件、317 条测试）全绿。
- Regression — 偏好关闭时 `setMirrorEnabled(id, true)` 正常 resolve 且不触碰外部目录；`reconcile` 移除本应用链接，同时保留用户创建的文件与目录。
- Regression — `src/renderer/pages/settings/__tests__/SkillsSettings.test.tsx` 与 `SkillDetails.test.tsx` 覆盖开关行与禁用且被覆盖的单技能勾选框（3 个文件、24 条测试）。
- Regression — 使用隔离 `HOME` 的真实 Electron 运行：启动时有 10 条本应用拥有的链接；在设置页关闭开关后全部移除，用户文件与目录保留；重启后不回填；重新打开开关后恢复同样 10 条链接。
