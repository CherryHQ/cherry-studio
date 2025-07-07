# Cherry Studio 贡献者指南

[**English**](../CONTRIBUTING.md) | [**中文**](CONTRIBUTING.zh.md)

欢迎来到 Cherry Studio 的贡献者社区！我们致力于将 Cherry Studio 打造成一个长期提供价值的项目，并希望邀请更多的开发者加入我们的行列。无论您是经验丰富的开发者还是刚刚起步的初学者，您的贡献都将帮助我们更好地服务用户，提升软件质量。

## 如何贡献

以下是您可以参与的几种方式：

1. **贡献代码**：帮助我们开发新功能或优化现有代码。请确保您的代码符合我们的编码标准，并通过所有测试。

2. **修复 BUG**：如果您发现了 BUG，欢迎提交修复方案。请在提交前确认问题已被解决，并附上相关测试。

3. **维护 Issue**：协助我们管理 GitHub 上的 issue，帮助标记、分类和解决问题。

4. **产品设计**：参与产品设计讨论，帮助我们改进用户体验和界面设计。

5. **编写文档**：帮助我们完善用户手册、API 文档和开发者指南。

6. **社区维护**：参与社区讨论，帮助解答用户问题，促进社区活跃。

7. **推广使用**：通过博客、社交媒体等渠道推广 Cherry Studio，吸引更多用户和开发者。

## 开始之前

请确保阅读了[行为准则](../CODE_OF_CONDUCT.md)和[LICENSE](../LICENSE)。

## 开始贡献

为了让您更熟悉代码，建议您处理一些标记有以下标签之一或多个的问题：[good-first-issue](https://github.com/CherryHQ/cherry-studio/labels/good%20first%20issue)、[help-wanted](https://github.com/CherryHQ/cherry-studio/labels/help%20wanted) 或 [kind/bug](https://github.com/CherryHQ/cherry-studio/labels/kind%2Fbug)。任何帮助都会收到欢迎。

### 测试

未经测试的功能等同于不存在。为确保代码真正有效，应通过单元测试和功能测试覆盖相关流程。因此，在考虑贡献时，也请考虑可测试性。所有测试均可本地运行，无需依赖 CI。请参阅[开发者指南](dev.md#test)中的“Test”部分。

### 拉取请求的自动化测试

自动化测试会在 Cherry Studio 组织成员开启的拉取请求（PR）上触发，草稿 PR 除外。新贡献者开启的 PR 最初会标记为 needs-ok-to-test 标签且不自动测试。待 Cherry Studio 组织成员在 PR 上添加 /ok-to-test 后，测试通道将被创建。

### 考虑将您的拉取请求作为草稿打开

并非所有拉取请求在创建时就准备好接受审查。这可能是因为作者想发起讨论，或者他们不完全确定更改是否朝着正确的方向发展，甚至可能是因为更改尚未完成。请考虑将这些 PR 创建为[草稿拉取请求](https://github.blog/2019-02-14-introducing-draft-pull-requests/)。草稿 PR 会被CI跳过，从而节省CI资源。这也意味着审阅者不会被自动分配，社区会理解此 PR 尚未准备好接受审阅。
在您将草稿拉取请求标记为准备审核后，审核人员将被分配

### 贡献者遵守项目条款

我们要求每位贡献者证明他们有权合法地为我们的项目做出贡献。贡献者通过有意识地签署他们的提交来表达这一点，并通过这一行为表明他们遵守许可证[LICENSE](LICENSE)。
签名提交是指提交信息中包含以下内容的提交：

```
Signed-off-by: Your Name <your.email@example.com>
```

您可以通过以下命令[git commit --signoff](https://git-scm.com/docs/git-commit#Documentation/git-commit.txt---signoff)生成签名提交：

```
git commit --signoff -m "Your commit message"
```

### 获取代码审查/合并

维护者在此帮助您在合理时间内实现您的用例。他们会尽力在合理时间内审查您的代码并提供建设性反馈。但如果您在审查过程中受阻，或认为您的 Pull Request 未得到应有的关注，请通过 Issue 中的评论或者[社群](README.zh.md#-community)联系我们

### 参与测试计划

测试计划旨在为用户提供更稳定的应用体验和更快的迭代速度，详细情况请参阅[测试计划](testplan-zh.md)。

### 其他建议

- **联系开发者**：在提交 PR 之前，您可以先和开发者进行联系，共同探讨或者获取帮助。
- **成为核心开发者**：如果您能够稳定为项目贡献，恭喜您可以成为项目核心开发者，获取到项目成员身份。请查看我们的[成员指南](https://github.com/CherryHQ/community/blob/main/membership.md)

## 联系我们

如果您有任何问题或建议，欢迎通过以下方式联系我们：

- 微信：kangfenmao
- [GitHub Issues](https://github.com/CherryHQ/cherry-studio/issues)

感谢您的支持和贡献！我们期待与您一起将 Cherry Studio 打造成更好的产品。
