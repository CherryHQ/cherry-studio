# Agent Note: 可配置的近期原文保留份额

Status: implemented

[English](2026-11-06-context-compression-keep-percent.md) | 中文

## Problem
用户无法调整压缩后保留的近期原文数量。

## Decision
新增以压缩触发阈值为基数的全局百分比，默认为 37.5，助手可选择覆盖。两条压缩车道使用解析后的份额。

## Alternatives considered
固定比例无法解决原有限制；以整个窗口为基数会改变预算含义。

## Consequences
按完整轮次保留原文，摘要另占空间。助手留空时继承全局设置。

## Verification
- AC1 — 触发阈值为 3200 和 2000 时默认预算分别为 1200 和 750。（verification: unit）
- AC2 — 两条车道均在较高份额下保留更多近期内容。（verification: unit）
- AC3 — 全局和助手控件提供该设置；清空助手字段时继承全局值。（verification: renderer）
- AC4 — 全局控件把 62.5 写入 `chat.context_settings.compress.keep_percent`，应用重启后仍显示 62.5。（verification: Electron）
