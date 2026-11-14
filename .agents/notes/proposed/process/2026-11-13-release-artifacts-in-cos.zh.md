# Agent Note: 将发布构建产物存入腾讯云 COS

Status: proposed

[English](2026-11-13-release-artifacts-in-cos.md) | 中文

## Problem

[发布工作流](../../../../.github/workflows/release.yml) 使用 Actions artifact 在任务间传输各平台安装包并保留完整归档。之前的 GitCode 同步先下载并解压归档，再把产物复制到 COS。v2.2.1 的 Ubuntu 任务解压了 8 GB 归档，但向上海地域域名上传分块时失败。之后的 Ubuntu 对照测试通过全球加速域名上传并校验 49 MiB 文件，用时 6.82 秒。生产大小的传输仍需验证。 [发布运行](https://github.com/CherryHQ/cherry-studio/actions/runs/43267392049) · [域名对照测试](https://github.com/CherryHQ/cherry-studio/actions/runs/43370677985)

## Proposal

各平台和版本的构建 runner 通过全球加速域名，直接将构建好的发布文件上传到现有私有 COS 桶的 `releases-sync/` 前缀。按发布版本、构建运行、平台和版本类型区分对象键，每个文件可独立读取。该平台全部上传完成后才写入文件清单。所有必需上传成功后，草稿组装记录引用这些对象的完整清单，并用 Global 文件更新 GitHub 草稿。单平台重建可以从同一源提交的完整清单复用其他平台的条目。缺少该清单时重建失败。

GitHub 发布后，GitCode 同步从 COS 读取选定的完整清单，逐文件传输 Global 和 CN 产物，先上传安装包，再上传更新清单。sync-only 按标签和来源运行定位存于 COS 的构建。保留已发布门禁，组装时检查必需文件和更新清单引用。发布与同步依据清单选取附件，省去下载 GitHub Release 附件做比对。

构建摘要中的 CN 安装包链接改为对应私有 COS 对象的限时访问链接。现有的其他诊断产物和日志不在改动范围内。早于 COS 暂存机制的历史构建继续保留已有 artifact。如需使用 COS 同步路径，需单独迁移。

## Alternatives considered

在同步任务中把完整 Actions artifact 复制到 COS 会重复传输，且重试仍依赖 Actions 下载。HTTPS 回源在该桶中返回了部分内容，但完整归档未入桶。在构建任务中直接上传现有文件，COS 可直接接收各个发布文件。

## Acceptance criteria

- AC1 — Windows、macOS 和 Linux 发布构建通过全球加速把两个版本直接上传到 COS，发布包和发布历史均不创建 Actions artifact (verification: GitHub integration by the release maintainer)
- AC2 — 草稿组装读取完整 COS 清单，只将 Global 和共享文件添加到 GitHub，单平台重建仅替换同一提交基线中的目标平台 (verification: unit and GitHub integration by the implementation author)
- AC3 — GitHub 发布后，GitCode 同步与 sync-only 从 COS 发布两个版本，安装包先于更新清单可用，无需下载完整 Actions 归档 (verification: GitHub integration by the release maintainer)
- AC4 — 上传失败时没有完整清单，dry run 仅预览文件而不写入，CN 摘要链接仅指向所选运行中已上传的安装包 (verification: unit and GitHub integration by the implementation author)

## Risks

全球加速会产生传输费用，且每种发布 runner 都需验证。COS 生命周期需覆盖重试窗口，包括被较新单平台重建引用的对象。持有签名链接即可临时访问安装包，因此上线前需检查链接有效期和工作流可见性。
