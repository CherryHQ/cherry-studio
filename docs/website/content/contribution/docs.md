---
icon: book-open
---

# 贡献文档

发现错误路径、过时步骤、缺少的截图或翻译问题，都可以帮助我们改进文档。目标是让读者按页面步骤完成任务。

## 提交修改

1. 点击文档底部的【在 GitHub 编辑】，进入 [Cherry Studio 网站仓库](https://github.com/CherryHQ/cherry-studio-website)。
2. 在自己的分支或 Fork 中修改文件。文档源文件位于 `docs-site/content/`，简体中文直接放在该目录，其他语言位于 `i18n/` 下的对应目录。
3. 新增、移动或删除页面时，同步修改对应语言的 `SUMMARY.md`。图片放在 `docs-site/content/assets/`，使用相对路径引用。
4. 预览并检查后，向网站仓库的 `main` 分支提交 Pull Request。说明修改了哪个页面、解决什么问题，以及如何验证。

文档只在网站仓库中维护，不再向旧文档仓库或 GitBook 提交修改。

不方便直接修改时，可以在 [网站仓库创建 Issue](https://github.com/CherryHQ/cherry-studio-website/issues)，附上页面地址、问题描述和建议。截图请遮挡 API Key、邮箱及其他私人信息。

## 本地预览与检查

在网站仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

打开终端给出的地址，再进入 `/docs/zh-cn/` 或其他语言路径。修改 Markdown 或图片后，开发服务会重新生成内容。

提交前运行：

```sh
pnpm docs:test
pnpm build:cn
pnpm docs:verify
```

检查 `docs-site/generated/report.json` 中的缺失链接、图片和锚点。不要直接修改 `generated/`、`out/` 或复制生成的资源；应修复 `content/` 内的源文件。更多说明见 [文档维护说明](https://github.com/CherryHQ/cherry-studio-website/blob/main/docs-site/README.md)。

## 编写与验收

- 先核对当前产品中的入口、按钮名称、默认值和实际结果，再编写步骤。
- 开头说明适用场景，步骤中写清操作位置、预期结果和失败时先检查哪里。
- 使用 Markdown 标题、列表、表格和链接；需要折叠内容时可以使用 `<details>` 与 `<summary>`。
- 截图使用真实产品界面，尽量采用 WebP，并补充说明图片内容的替代文本。
- 修改配置教程时区分产品默认值和建议设置，不编造连接成功、付费服务可用或模型输出结果。
- 检查目录、正文链接、图片、移动端阅读及各个操作步骤；构建通过不代表读者一定能照着完成任务。
- 翻译应与当前原文核对，不仅保留旧版本的操作步骤。

请尽量让没有参与编写的人只看教程完成一次操作，再根据他遇到的问题改进文档。
