---
description: 备份 V1 数据，直接使用 V2 完成迁移，并检查需要重新配置的项目。
icon: arrow-right-arrow-left
---

# V1 升级到 V2

{% hint style="danger" %}
迁移是单向的：V1 数据可以进入 V2，V2 新数据不会同步回 V1。升级前请同时保留 V1 完整备份和完全退出应用后复制的整个 V1 数据目录。
{% endhint %}

{% hint style="warning" %}
保留数据的正确路径是：**V1.9.13 → V2（直接完成数据迁移）**，无需先安装特定的 V2 中转版本。
{% endhint %}

## 根据当前情况选择

| 当前情况 | 操作 |
| --------------- | ------------------------------------ |
| 仍在 V1，需要保留数据 | 将 V1 更新到 1.9.13，按本页步骤直接安装 V2。 |
| 已经在使用 V2 | 正常升级 V2，继续使用当前 V2 数据；不要点击【重新迁移】。 |
| 之前迁移 V1 失败或遗漏数据 | 完整备份当前 V2 后，才可使用【重新迁移】从 V1 重新开始。 |
| 不需要 V1 数据 | 可以选择【忽略并使用默认值】，从默认配置开始；V1 数据不会迁入。 |

## 升级前确认

* V1 不低于 1.9.12，建议先更新到最终版 1.9.13 并至少启动一次。
* 首次迁移可以直接使用 V2。
* 自定义数据目录或外置磁盘可以正常读写。
* 对话、智能体、知识库导入和文件处理任务均已结束。

{% hint style="warning" %}
迁移向导读取当前 V1 数据目录，不读取 V1 备份 ZIP。备份用于意外恢复，不能代替原数据目录参与迁移。
{% endhint %}

## 操作步骤

{% stepper %}
{% step %}
### 更新并备份 V1

将 V1 更新到 1.9.13。在数据备份页面关闭【精简备份】，创建完整备份，并把备份保存在应用数据目录之外。
{% endstep %}

{% step %}
### 复制整个 V1 数据目录

在 V1 的数据设置中确认目录位置，完全退出 Cherry Studio 后复制整个目录。不要只复制数据库文件。
{% endstep %}

{% step %}
### 检查自定义目录

使用移动硬盘、网络卷或其他自定义位置时，确认路径已挂载且可读写。路径不可访问时不要改用默认目录继续迁移。
{% endstep %}

{% step %}
### 首次启动 V2

从 [V2 官方下载](https://cherryai.com.cn/download) 获取匹配系统和芯片的 V2 安装包，也可以使用 [GitCode 发布页](https://gitcode.com/CherryHQ/cherry-studio/releases) 或 [GitHub 发布页](https://github.com/CherryHQ/cherry-studio/releases)。完全退出 V1 后安装并启动。
{% endstep %}

{% step %}
### 完成【数据迁移向导】

核对向导显示的数据位置，再选择【开始迁移】。迁移期间不要关闭应用、移动数据目录或断开外置磁盘。
{% endstep %}

{% step %}
### 查看结果并重启

迁移完成后先展开警告信息，再选择【重启应用】。
{% endstep %}
{% endstepper %}

## 升级后检查

* 检查常用模型服务、API Key 和默认模型。
* 检查助手分组、提示词、智能体权限和知识库绑定。
* 打开常用会话、知识库和文件；只重建显示失败的知识来源。
* 在【设置】→【网络搜索】重新确认关键词搜索和网址读取服务。
* 检查侧栏收藏和自定义 CSS。
* 在【设置】→【数据】创建新的 V2 完整备份。

更多入口变化见 [【功能差异】](v1-v2-feature-differences.md)。

## 只有迁移失败才使用【重新迁移】

如果此前 V1 迁移失败或遗漏数据，V2 可在【设置】→【数据】选择【重新迁移】。该操作会重启应用，并从保留的 V1 数据重新执行迁移。

{% hint style="danger" %}
【重新迁移】会永久删除当前 V2 数据，不会把 V1 与 V2 数据合并。除非此前 V1 迁移失败或遗漏数据，否则一定不要点击。操作前必须创建当前 V2 的完整备份；需要保留的 V2 新内容还应单独导出。
{% endhint %}

## 迁移失败时

| 选项 | 什么时候用 | 注意事项 |
| ---------- | --------------- | ---------------------------------------------- |
| 【重试】 | 修复目录、磁盘或临时数据问题后 | 优先选择，不会退出迁移流程。 |
| 【保存问题信息】 | 重试仍失败，需要求助 | 文件只保存到本地，可能包含路径、内容或凭据，只提供给 Cherry Studio 支持团队。 |
| 【忽略并使用默认值】 | 明确放弃导入 V1 数据 | 清除本次已写入的部分 V2 数据并从默认配置开始；之后不再自动提示迁移。 |
| 【继续使用 V1】 | 暂时无法迁移，需要恢复工作 | 重新安装 V1 并继续使用原 V1 数据目录。 |

{% hint style="danger" %}
迁移失败或误选【忽略并使用默认值】时，不要自行删除数据库，也不要反复覆盖安装。保留 V1 原数据与备份并联系 Cherry Studio 支持团队。
{% endhint %}

## 常见问题

<details>

<summary>只有 V1 备份 ZIP，可以直接迁移吗？</summary>

不可以。先在兼容的 V1 中恢复并确认数据正常，再保留完整数据目录，然后启动 V2 迁移。

</details>

<details>

<summary>知识库都要重建索引吗？</summary>

不需要。有效索引会迁移；只处理显示失败、缺少嵌入模型或无法读取的来源。

</details>

## 参考资料

* [Cherry Studio V2 官方下载](https://cherryai.com.cn/download)
* [Cherry Studio V1 官方下载](https://cherryai.com.cn/download/v1)
* V2 发布页：[GitCode](https://gitcode.com/CherryHQ/cherry-studio/releases) · [GitHub](https://github.com/CherryHQ/cherry-studio/releases)
* [官方迁移设计说明](https://github.com/CherryHQ/cherry-studio/blob/main/src/main/data/migration/v2/README.md#version-compatibility-gate)
* [问题反馈与功能建议](../../question-contact/suggestions.md)
