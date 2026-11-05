# Cherry Studio · 回答插图版

让回答边讲边画：模型在解释的相应位置写出绘画提示词，应用随即生成图片并嵌入正文。

这是 [leezehuan/cherry-studio](https://github.com/leezehuan/cherry-studio) 维护的修改版，基于 [CherryHQ/cherry-studio](https://github.com/CherryHQ/cherry-studio)。本页只介绍本 fork 的变化；原版功能与通用配置请参阅[官方文档](https://cherryai.com/docs/en/)。

[下载 Windows 版](https://github.com/leezehuan/cherry-studio/releases/latest) · [详细修改记录](./README.changes.zh-CN.md) · [反馈问题](https://github.com/leezehuan/cherry-studio/issues)

## 修改版有什么特点

- **插图跟着解释走**：图片出现在回答中对应的位置，文字和图片保持原有顺序。
- **文字与生图同时进行**：收到完整绘画提示词后立即加入生图队列，不必等待整条回答结束；生成期间显示占位，完成后原位显示图片。
- **不额外调用语言模型写提示词**：绘画描述由回答模型在同一次回复中给出，应用自动处理，无需用户手动编写标记。
- **复用原有绘画配置**：直接使用 Cherry Studio 的绘画模型、服务商凭据和文件管理能力，无需额外启动 MCP 服务或部署本机图片 HTTP 服务。
- **控制模式与数量**：自动、强制开启、强制关闭三档模式；每条回答最多 1–10 张，也可开启目标张数要求。
- **查看、取消和重试**：可展开查看每张图的实际生图提示词，单独取消未完成插图，失败或取消后手动重试。
- **保存后继续查看**：普通聊天保存图片及提示词，重新打开不会自动重复生图；临时聊天也支持插图，并遵循原有临时数据生命周期。

## 下载与运行

在本仓库的 [GitHub Releases](https://github.com/leezehuan/cherry-studio/releases) 下载 **Windows x64** 构建：

| 文件 | 用途 |
| --- | --- |
| `Cherry-Studio-2.1.10-win-x64-portable.exe` | 免安装，双击启动 |
| `Cherry-Studio-2.1.10-win-x64-setup.exe` | 安装到电脑，可选择安装目录 |

当前发布基于 Cherry Studio **2.1.10**，提供国际版 x64 构建。其他系统暂未提供本 fork 的安装包。当前构建未进行 Windows 代码签名。

## 开始使用

1. 配置可用的图片生成服务商及绘画模型。
2. 打开 **设置 → 外观 → 消息 → 回答插图**，选择 **自动** 或 **强制开启**。默认状态为 **强制关闭**。
3. 在同一区域选择绘画模型，按需调整插图上限、强制插图张数开关和目标张数。
4. 在普通单模型聊天中发送问题，例如：**“解释水循环，在关键步骤配上科普插图。”**
5. 回答中的插图位置会先显示加载占位，生图完成后自动显示图片；使用 **查看生图提示词** 查看绘画描述。

| 模式 | 行为 |
| --- | --- |
| 自动 | 让模型按内容决定是否配图、插入位置和数量 |
| 强制开启 | 要求模型每条回答至少配一张图，并遵守数量上限 |
| 强制关闭 | 不处理新插图，已有图片仍可查看 |

开启 **强制插图张数** 后，自动和强制开启模式都会要求模型输出目标张数。数量上限由程序执行；最低张数和精确张数依赖模型遵循指令，不能保证最终成功图片数量。模式和数量变更从下一条回答生效。

## 当前边界

- 支持普通单模型聊天和临时聊天，尚不覆盖 Agent 编程会话与多模型回答组。
- 最多同时执行 2 项生图请求，其余排队；每项活动请求的超时为 5 分钟。
- 停止回答会取消尚未完成的生图，已完成图片保留。应用重启后，未完成请求标记为中断，不自动续跑。
- 图片生成及手动重试可能产生服务商费用；需要自行配置可用的服务与模型。
- 本 fork 的回答插图功能尚未合入上游。详细验证记录、模型遵循限制及兼容性说明见[修改记录](./README.changes.zh-CN.md)。

## 源码与上游

- [插图功能用户指南](./docs/website/content/pre-basic/settings/display.md#回答插图)
- [开发与构建说明](./docs/dev/contrib/development.md)
- [上游项目](https://github.com/CherryHQ/cherry-studio) · [上游贡献者](https://github.com/CherryHQ/cherry-studio/graphs/contributors)

本项目沿用 [GNU AGPL-3.0](./LICENSE) 许可证。Cherry Studio 原项目的版权与贡献归原作者及贡献者所有；本仓库提供回答插图定制及对应源码。
