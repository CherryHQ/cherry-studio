# Agent Note: 校验 Changeset 的包资格

Status: implemented

[English](2026-11-18-changeset-package-eligibility.md) | 中文

## 问题

Changeset 可以引用内部包或未修改的包。在版本处理时跳过某个包，并不能阻止贡献者添加此类条目。

## 决策

现有 `changeset:check` 门禁拒绝所有待处理 Changeset 中不存在、私有或被忽略的包。它使用 Changesets 配置和工作区发现机制，不依赖 npm 注册表状态或依赖协议。

指定 `--base <ref>` 时，新增或编辑的 Changeset 必须引用相对合并基点有文件改动的包，包括本地已暂存、未暂存和未跟踪的改动。PR CI 传入目标分支。发布自动化不执行此比较，因为 main 会积累多个 PR 的 Changeset。

## 考虑过的替代方案

- 仅依赖 Changesets 的跳过配置，无法在贡献阶段拒绝无效条目。
- 将所有待处理 Changeset 与单个 PR 比较，会拒绝从基线继承的有效条目。
- 查询 npm 发布历史会阻止首次发布，并引入网络依赖。

## 影响

空 Changeset 仍然有效。工作区依赖协议不决定包的资格。包内任何文件改动都计入，包括文档修改和文件删除；门禁不判断该改动是否值得发布。依赖引起的版本提升仍由 Changesets 负责。

## 验证

- Regression — `pnpm test:scripts scripts/__tests__/changeset-policy.test.ts`：真实 Git fixture 覆盖无效包条目、本地和已提交的包改动、继承的 Changeset，以及 `packages/*` 以外包的首次发布。
