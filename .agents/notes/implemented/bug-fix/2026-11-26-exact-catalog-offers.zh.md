# Agent Note: 目录刷新保留供应商的独立模型条目

Status: implemented

[English](2026-11-26-exact-catalog-offers.md) | 中文

## 问题

每日刷新按规范模型 ID 去重。付费路由和免费变体共用该 ID 时，生成的目录可能保留免费价格，而应用仍使用付费请求 ID。

## 决策

价格和限制归属具体的供应商条目。供应商使用命名空间或不同版本分隔符时，按规范 ID 查询优先匹配无变体后缀的条目。按完整 API ID 查询可独立找到带后缀的条目。

CherryIN 的 `(free)` 条目按完整 API ID 建索引，付费条目不会继承零价。CherryIN 的供应商声明维护该平台公布的模型协议和价格。

每日工作流在更新 PR 前检查生成目录，并一起提交变更的模型数据和工具索引。

## 考虑过的替代方案

每个规范模型只保留一条记录，会丢失可独立调用的条目。选第一条会让价格受上游数组顺序影响。

## 影响

一个模型可对应多条供应商记录。候选目录违反现有契约时，需要修复源数据，自动化才能更新 PR。

## 验证

- Regression — `catalog-invariants.test.ts`：Nemotron 付费和免费路由各自使用对应价格，规范 ID 查询结果与记录顺序无关。
- Regression — `alibaba-catalog.test.ts`：Qwen4 Max 保留原厂输出上限，OpenRouter 路由使用自身上限及推理设置。
- Regression — `registry.test.ts` 和 `ProviderRegistryService.test.ts`：CherryIN 的免费价格和图像价格按完整路由生效，并进入模型选择数据。
