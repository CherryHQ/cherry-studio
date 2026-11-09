---
icon: code
---

# 贡献代码

代码贡献从一个清楚的问题开始。修复缺陷前先确认能够复现；增加功能前先说明用户场景和预期行为。范围较大的改动，建议先在 GitHub Issue 或 Discussion 中对齐方向。

<figure><img src="../assets/1164345d768ece8f74263a79.webp" alt="从说明问题、最小改动、本地验证到提交评审和合并的贡献流程图"><figcaption><p>一次贡献只解决一个清楚的问题，先完成本地验证，再提交评审。</p></figcaption></figure>

## 开始前

<table data-view="cards"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><strong>Cherry Studio 仓库</strong></td><td>源码、README 和开发入口</td><td><a href="https://github.com/CherryHQ/cherry-studio">https://github.com/CherryHQ/cherry-studio</a></td></tr><tr><td><strong>GitHub Issues</strong></td><td>缺陷、功能建议和待解决问题</td><td><a href="https://github.com/CherryHQ/cherry-studio/issues">https://github.com/CherryHQ/cherry-studio/issues</a></td></tr><tr><td><strong>贡献指南</strong></td><td>分支、测试、签署和评审要求</td><td><a href="https://github.com/CherryHQ/cherry-studio/blob/main/CONTRIBUTING.md">https://github.com/CherryHQ/cherry-studio/blob/main/CONTRIBUTING.md</a></td></tr><tr><td><strong>行为准则</strong></td><td>社区协作边界</td><td><a href="https://github.com/CherryHQ/cherry-studio/blob/main/CODE_OF_CONDUCT.md">https://github.com/CherryHQ/cherry-studio/blob/main/CODE_OF_CONDUCT.md</a></td></tr></tbody></table>

适合上手的任务可以从 `good first issue`、`help wanted` 和 `kind/bug` 标签中寻找。准备开始前，在 Issue 中说明你打算处理，避免多人重复投入。

## 分支怎么选

大多数当前功能、修复、重构和优化都提交到 `main`。如果 Issue、维护者说明或贡献指南指定了其他目标分支，以当时的项目说明为准；不要仅凭旧教程判断。

{% hint style="warning" %}
不要从旧教程判断目标分支。创建 PR 前再次查看仓库当前贡献指南和 PR 模板；分支策略发生变化时，以仓库内容为准。
{% endhint %}

## 适合贡献代码的情况

| 情况 | 建议做法 |
| ------------ | -------------------------- |
| 能稳定复现的问题 | 先提交最小修复和对应检查 |
| 边界清楚的小功能 | 先确认需求与目标分支，再开始实现 |
| 涉及数据迁移、权限或架构 | 先在 Issue 或 Discussion 对齐方案 |
| 只需要改说明或截图 | 走【贡献文档】，不要混进代码 PR |

{% hint style="info" %}
一个 PR 只解决一个清楚的问题。若修改同时包含功能、重构和无关格式化，审阅者很难判断风险，也更难回滚。
{% endhint %}

## 提交流程

{% stepper %}
{% step %}
### 1. Fork 并建立分支

从正确的目标分支建立一个范围清楚的工作分支。一个 PR 只解决一个主题，不把顺手的重构和格式调整混进去。
{% endstep %}

{% step %}
### 2. 准备开发环境

按照仓库【Developer Guide】安装指定的 Node.js 与 pnpm 版本，执行 `pnpm install`。开始改动前先运行与目标模块相关的现有检查，确认基线可用。
{% endstep %}

{% step %}
### 3. 修改并验证

缺陷修复应加入能够复现问题的测试；新功能应覆盖关键路径和失败场景。提交前运行仓库要求的格式、静态检查、测试和构建检查。
{% endstep %}

{% step %}
### 4. 提交并签署

提交信息写清改动类型和模块，并使用 `git commit --signoff` 添加 DCO 签署。签署表示你有权按项目许可提交这部分内容。
{% endstep %}

{% step %}
### 5. 创建 PR

按模板填写改动前后、采用这种方案的原因、权衡与替代方案、破坏性变化、验证方式和 Release Note。仍需讨论的改动可以先建 Draft PR。
{% endstep %}
{% endstepper %}

## PR 提交后

新贡献者的 PR 会先带有 `needs-ok-to-test`，自动测试不会立即开始。仓库成员确认后会使用 `/ok-to-test` 启动流水线。Draft PR 不分配常规评审，也会跳过自动测试；准备好后再标记为 Ready for review。

评审意见应通过新增提交修复，保持讨论上下文。发生设计分歧时，先回到用户问题和可验证行为，不用大范围改写来回避一个局部问题。

## 提交前自查

* 目标分支正确；
* 变更范围与 Issue/PR 描述一致；
* 新行为有测试或可重复的手动验证步骤；
* 用户可见变化同步更新文档；
* 数据迁移、升级和兼容性已经考虑；
* 没有提交 API Key、真实用户数据或调试文件；
* Commit 已签署，Release Note 符合模板要求。

<details>

<summary>小改动也需要 Issue 吗？</summary>

拼写、明显的小修复可以直接提交；涉及产品行为、架构或较大工作量时，先开 Issue 更容易确认方向。是否需要 Issue 以仓库当前维护规则为准。

</details>

<details>

<summary>CI 为什么没有自动运行？</summary>

先确认 PR 不是 Draft。新贡献者的 PR 需要仓库成员 `/ok-to-test`，看到 `needs-ok-to-test` 时在 PR 中耐心等待确认即可。

</details>
