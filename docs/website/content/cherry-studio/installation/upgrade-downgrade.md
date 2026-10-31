---
description: 选择版本切换路径，并在操作前保护好 V1 与 V2 数据。
icon: arrows-rotate
---

# 升级与降级

根据当前版本和目标选择对应说明。V1 与 V2 使用不同的数据结构，跨大版本切换前必须先备份。

{% hint style="danger" %}
V1 与 V2 的数据和备份格式不互通。V2 中新增的会话、智能体、设置和文件不会自动回写到 V1。
{% endhint %}

## V2 升级与迁移

{% hint style="warning" %}
需要保留 V1 数据时，正确路径是：**V1.9.13 → V2（直接完成数据迁移）**，无需先安装特定的 V2 中转版本。
{% endhint %}

| 当前情况 | 应该怎么做 |
| --------------- | ------------------------------------ |
| 仍在 V1，需要保留数据 | 将 V1 更新到 1.9.13，再直接安装 V2 完成迁移。 |
| 已经在使用 V2 | 正常升级 V2，继续使用当前 V2 数据；不要点击【重新迁移】。 |
| 之前迁移 V1 失败或遗漏数据 | 完整备份当前 V2 后，才可在【设置】→【数据】使用【重新迁移】。 |
| 不需要 V1 数据 | 可以选择【忽略并使用默认值】，但 V1 数据不会迁入。 |

{% hint style="danger" %}
【重新迁移】会永久删除当前 V2 数据，再从原始 V1 数据重新导入，不会合并或保留两边的数据。除非此前 V1 迁移失败或遗漏数据，否则一定不要点击。
{% endhint %}

## 选择路径

<table data-view="cards"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><strong>破坏性更新提醒</strong></td><td>先确认数据不互通、重新迁移和回退限制。</td><td><a href="v2-breaking-update-notice.md">v2-breaking-update-notice.md</a></td></tr><tr><td><strong>功能差异</strong></td><td>了解界面、智能体、知识库等变化和升级后需要复核的项目。</td><td><a href="v1-v2-feature-differences.md">v1-v2-feature-differences.md</a></td></tr><tr><td><strong>V1 升级到 V2</strong></td><td>备份 V1 数据，直接使用 V2 完成迁移。</td><td><a href="v1-to-v2-migration.md">v1-to-v2-migration.md</a></td></tr><tr><td><strong>V2 降级到 V1</strong></td><td>返回原 V1 数据，并了解什么时候才需要处理 V2 数据库。</td><td><a href="v2-to-v1-downgrade.md">v2-to-v1-downgrade.md</a></td></tr></tbody></table>

## 切换前准备

1. 结束正在运行的对话、智能体、知识库导入和文件处理任务。
2. 为当前版本创建一份新的完整备份，并保存在应用数据目录之外。
3. 记录当前应用数据目录；使用自定义目录或外置磁盘时，确认路径可以正常访问。

{% hint style="warning" %}
不要为了“彻底卸载”手动删除应用数据。数据库处理只适用于明确放弃全部 V2 数据或重新迁移的情况，详见 [【V2 降级到 V1】](v2-to-v1-downgrade.md)。
{% endhint %}

## 下载入口

* [Cherry Studio V2 官方下载](https://cherryai.com.cn/download)
* [Cherry Studio V1 官方下载](https://cherryai.com.cn/download/v1)
* V2 发布页：[GitCode](https://gitcode.com/CherryHQ/cherry-studio/releases) · [GitHub](https://github.com/CherryHQ/cherry-studio/releases)
