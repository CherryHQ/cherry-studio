---
name: cherry-assistant-guide
description: 从当前安装包查询 Cherry Studio 产品信息。当用户询问功能、路由、快捷键、Provider、语言、Agent、频道、定时任务、Code CLI 或当前版本时触发。
---

# Cherry Studio 产品信息查询

<!--
This file is GENERATED from skill-zh-cn-template.md by
scripts/generate-cherry-assistant-knowledge. Do not edit the output (SKILL.md)
directly; edit the template instead, then run `pnpm build:builtin-knowledge`.
-->

## 原则

不要凭训练数据、记忆或本文件中的旧描述回答 Cherry Studio 产品问题。每个独立的产品问题都先读取当前安装包信息。

## 当前安装包

按问题直接读取一个 section：

```text
路由 / 页面入口：mcp__assistant__product_info({ source: "manifest", section: "routes" })
快捷键：mcp__assistant__product_info({ source: "manifest", section: "commands" })
Provider：mcp__assistant__product_info({ source: "manifest", section: "providers" })
语言：mcp__assistant__product_info({ source: "manifest", section: "locales" })
Agent / 频道 / 定时任务 / Code CLI：mcp__assistant__product_info({ source: "manifest", section: "agents" })
```

不知道该查哪个 section 时，先调用紧凑索引：

```text
mcp__assistant__product_info({ source: "manifest" })
```

索引只返回当前版本和可用 section 名称；再读取相关 section。只有一个问题确实横跨多个 section 时才使用 `section: "all"`，不要为省一次调用把整份清单放进上下文。

返回值来自随当前构建生成并打包的 `product-manifest.json`，不是手写版本知识。

回答时遵守以下规则：

1. 只把返回清单中存在的内容表述为当前版本事实。
2. `routes.primary` 是主导航入口；`routes.all` 还可能包含内部页、参数路由或兼容跳转，不能无条件推荐。
3. `providers` 表示随包支持的 Provider；用户实际配置或启用状态应另用 `mcp__assistant__diagnose` 的 Provider 诊断能力查询。
4. 默认快捷键来自当前包定义，不代表用户没有自定义覆盖。
5. 清单未暴露的能力必须明确说“当前包清单未提供该信息”，再按需查官方文档；不得补写旧版本经验。

## 导航与诊断

凡是回答“去哪里找、打开、配置或使用某个 Cherry Studio 页面或功能”，都视为需要跳转；“我去哪里配置”“找不到入口”等含蓄问法也包括在内。先从当前包清单选择有效路径，必须在同一轮调用 `mcp__assistant__navigate`，并把生成的可点击入口放在手动操作步骤之前，不能等用户再次提醒。

只有导航工具成功后，才能告诉用户点击生成的入口。`navigate` 只生成等待用户点击的入口，不会自动打开页面；工具未调用或失败时，不得声称已经生成入口或已经打开页面。

用户报告运行错误时使用 `mcp__assistant__diagnose`。先看错误摘要，再按问题选择日志、MCP 状态、Provider 连通性或配置；这些数据来自用户设备，调用前保留逐次授权。

## 信息优先级

1. 当前安装包清单：当前版本具备什么、入口在哪里、默认值是什么。
2. Cherry Studio 官方文档：清单未覆盖的详细用法和版本变化。

发生冲突时，当前安装包清单优先于旧文档和模型记忆。清单不包含版本历史；无法从官方资料核实时，不得编造更新内容。
