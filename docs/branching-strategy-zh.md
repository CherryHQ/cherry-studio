# 🌿 分支策略

Cherry Studio 采用结构化的分支策略来维护代码质量并简化开发流程。

## 主要分支

- `main`：主开发分支

  - 包含最新的开发代码
  - 禁止直接提交 - 所有更改必须通过拉取请求（Pull Request）
  - 此分支上的代码可能包含正在开发的功能，不一定完全稳定

- `release/*`：发布分支
  - 从 `main` 分支创建
  - 包含准备发布的稳定代码
  - 只接受文档更新和 bug 修复
  - 经过完整测试后可以发布到生产环境

关于测试计划所使用的`testplan`分支，请查阅[测试计划](testplan-zh.md)。

## 贡献分支

在为 Cherry Studio 贡献代码时，请遵循以下准则：

1. **功能开发分支：**

   - 从 `main` 分支创建
   - 命名格式：`feature/issue-number-brief-description`
   - 完成后提交 PR 到 `main` 分支

2. **Bug 修复分支：**

   - 从 `main` 分支创建
   - 命名格式：`fix/issue-number-brief-description`
   - 完成后提交 PR 到 `main` 分支

3. **文档更新分支：**

   - 从 `main` 分支创建
   - 命名格式：`docs/brief-description`
   - 完成后提交 PR 到 `main` 分支

4. **紧急修复分支：**

   - 从 `main` 分支创建
   - 命名格式：`hotfix/issue-number-brief-description`
   - 完成后需要同时合并到 `main` 和相关的 `release` 分支

5. **发布分支：**
   - 从 `main` 分支创建
   - 命名格式：`release/version-number`
   - 用于版本发布前的最终准备工作
   - 只允许合并 bug 修复和文档更新
   - 完成测试和准备工作后，将代码合并回 `main` 分支并打上版本标签

## 工作流程

![](https://github.com/user-attachments/assets/61db64a2-fab1-4a16-8253-0c64c9df1a63)

## 拉取请求（PR）指南

- 除非是修复生产环境的关键问题，否则所有 PR 都应该提交到 `main` 分支
- 提交 PR 前确保你的分支已经同步了最新的 `main` 分支内容
- 在 PR 描述中包含相关的 issue 编号
- 确保所有测试通过，且代码符合我们的质量标准
- 如果你添加了新功能或修改了 UI 组件，请附上更改前后的截图

## 版本标签管理

- 主要版本发布：v1.0.0、v2.0.0 等
- 功能更新发布：v1.1.0、v1.2.0 等
- 补丁修复发布：v1.0.1、v1.0.2 等
- 紧急修复发布：v1.0.1-hotfix 等
