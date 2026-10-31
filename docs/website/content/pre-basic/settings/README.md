---
icon: gear
---

# 软件设置

Cherry Studio 的设置面板覆盖 **模型配置、工具能力、界面偏好、效率工具与系统行为** 等所有选项。设置左侧按 **模型 / 工具 / 偏好 / 效率 / 系统** 五大块分组，本节按同样的分组给出地图，方便你按需跳转。

### 模型

| 设置项 | 文档 | 内容 |
| --- | --- | --- |
| 模型服务 | [模型服务](../providers/) | Provider 添加、密钥、API 地址、多 Key 轮询 |
| 默认模型 | [默认模型设置](default-models.md) | 全局默认对话 / 命名 / 翻译等模型 |
| 本地模型 | [本地模型](local-models.md) | 内置、离线运行的嵌入模型与 OCR 模型 |
| API 网关 | [API 网关](../../advanced-basic/developer-tools/api-gateway.md) | 对外暴露本地 OpenAI 兼容 API |

### 工具

| 设置项 | 文档 | 内容 |
| --- | --- | --- |
| MCP | [MCP 与外部工具](../../advanced-basic/extensions/mcp/) | Model Context Protocol 工具接入 |
| 技能 | [技能与能力库](../../advanced-basic/extensions/skills.md) | 为助手或智能体加装专项能力 |
| 提示词 | — | 提示词模板的管理与调用（文档待补充）|
| 浏览器 | — | 内置浏览器与网页内容获取（文档待补充）|
| 网络搜索 | [联网模式](../websearch/) | 免费联网、Tavily、火山引擎、SearXNG 等 |
| 文档处理 | [文档处理](doc-process.md) | PDF / 复杂版式文档的结构化解析（MinerU 等） |
| OCR | [OCR](ocr.md) | 图片 / 扫描件的文字识别引擎 |

### 偏好

| 设置项 | 文档 | 内容 |
| --- | --- | --- |
| 外观 | [外观](display.md) | 主题、主题色、缩放、语言、话题布局 |
| 通知 | [通知](notification.md) | 助手消息、备份、知识库完成提醒 |
| 数据 | [数据设置](../data-settings/) | WebDAV / S3 备份与第三方集成 |
| 归档 | [文件 → 归档](../../cherrystudio/preview/files.md) | 已删除文件、助手、话题等的恢复与自动清理 |
| 用量统计 | [用量统计](usage.md) | 成本、Token、请求与每日活动统计 |

### 效率

| 设置项 | 文档 | 内容 |
| --- | --- | --- |
| 频道 | [频道](../../advanced-basic/automation/channels.md) | 智能体接入飞书 / Telegram 等 |
| 定时任务 | [定时任务](../../advanced-basic/automation/scheduled-heartbeat.md) | 智能体按 Cron 定时运行 |
| 快捷键 | [快捷键设置](key-shortcut.md) | 全部快捷键的修改与启停 |
| 快捷助手 | [快捷助手](../../cherrystudio/preview/quick-assistant.md) | 全局悬浮的迷你对话窗 |
| 划词助手 | [划词助手](../../cherrystudio/preview/selection-assistant.md) | 选中文字即时翻译 / 解释 / 改写 |
| 设备互联 | — | 与移动端等设备配对（文档待补充）|
| 截图 | — | 截图相关设置（文档待补充）|

### 系统

| 设置项 | 文档 | 内容 |
| --- | --- | --- |
| 系统 | [系统](general.md) | 启动、托盘、代理、硬件加速、开发者模式 |
| 环境依赖 | [环境依赖](env-dependencies.md) | uv / bun 等运行时与二进制工具的安装管理 |
| 关于我们 | — | 版本信息、检查更新、许可协议与社区链接 |

{% hint style="info" %}
设置改动会 **实时生效**，无需重启。涉及 Provider / 模型 / 默认模型这类核心项时，建议先在 `设置 → 数据` 中做一次备份。
{% endhint %}

***

### 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
