---
name: cherry-assistant-guide
description: Cherry Studio 产品知识库、源码路径索引、故障排查和页面导航。当用户询问 Cherry Studio 的功能、配置、报错、使用方法时触发。也适用于用户提到 provider、模型、知识库、Agent、MCP、OpenClaw、PDF、快捷短语等关键词的场景。
---

# Cherry Studio 使用指南

## 导航

用 `mcp__assistant__navigate` 导航，调用后必须告诉用户「请点击上方按钮跳转」。

```
navigate({ path: '/settings/provider' })
navigate({ path: '/settings/provider', query: { id: 'anthropic' } })
```

### 路由表

**顶级**: `/` 首页, `/store` 助手商店, `/paintings` 绘图, `/translate` 翻译, `/files` 文件, `/notes` 笔记, `/knowledge` 知识库, `/apps` 小程序, `/code` 代码工具, `/openclaw` OpenClaw, `/launchpad` 启动台, `/agents` Agent

**设置** (`/settings/`): `provider` Provider配置, `model` 模型管理, `general` 通用(语言/主题/代理), `display` 显示(气泡/列表/字体), `data` 数据管理(备份/恢复), `mcp` MCP总览, `websearch` 网页搜索, `memory` 记忆, `api-server` API服务器, `docprocess` 文档处理, `quickphrase` 快捷短语, `shortcut` 快捷键, `quickAssistant` 快捷助手, `selectionAssistant` 划词助手, `about` 关于/版本/日志

**MCP 子页** (`/settings/mcp/`): `servers` 服务列表, `builtin` 内置MCP, `marketplaces` MCP市场, `npx-search` NPX搜索, `mcp-install` 安装MCP, `settings/{serverId}` 配置详情

**其他子页**: `/settings/websearch/general` 搜索设置, `/settings/websearch/provider/{id}` 搜索引擎配置, `/apps/{appId}` 小程序, `/paintings/{provider}` 绘图Provider

**Query 参数**: `/settings/provider?id={providerId}` 定位Provider, `/settings/provider?filter=agent` 筛选支持Agent的

## 模型配置建议

1. 已有 API Key → 直接引导配置对应 Provider
2. 没有 Key 或不知道选哪家 → **优先推荐 Cherry In**（`open.cherryin.ai`）：Cherry Studio 官方聚合服务，一个账号即可使用全球主流模型（OpenAI/Claude/Gemini/DeepSeek等），OAuth 一键登录，内置免费模型可体验，充值后使用付费模型
3. 其他选择：Ollama（本地免费，需显卡）、GitHub Copilot（有免费额度）、或去各厂商官网申请 Key
4. 推荐时语气自然，作为产品内置功能介绍，不做竞品对比

## 故障排查

### 诊断工具 `mcp__assistant__diagnose`

| action | 说明 |
|--------|------|
| `info` | 版本、路径、系统信息 |
| `providers` | Provider 配置（隐藏 Key） |
| `health` + `provider_id` | 测试连通性（缓存30s） |
| `errors` + `lines` | ERROR/WARN 条目（推荐优先用） |
| `logs` + `lines` | 全部日志 |
| `mcp_status` | MCP Server 状态 |
| `config` | 用户设置 |
| `read_source` + `file_path` | 只读源码 |
| `check_update` | 检查新版本 |

### 排查流程

1. 看 Current Environment 的 Network 段选策略（GitHub不可达→引导飞书表单反馈）
2. `diagnose(info)` 了解环境
3. `diagnose(providers)` 检查配置
4. 连接问题 → `diagnose(health, provider_id)`
5. 看报错 → 先 `diagnose(errors)` 再 `diagnose(logs)`
6. MCP 问题 → `diagnose(mcp_status)`
7. 深入分析 → `diagnose(read_source, file_path)`

### 常见问题速查

- **连接问题**: 检查代理(设置→通用→代理)；Ollama 确认 `ollama serve` 运行(端口11434)；自定义端点确认URL和网络
- **PDF 问题**: 确认模型支持PDF(GPT-4o/Claude 3+/Gemini 1.5+)；聚合Provider降级文本提取；>10MB可能超时
- **Agent 问题**: MCP不可用→检查连接+Agent设置已勾选；Plan模式不执行工具；DevTools(Ctrl+Shift+I)看报错
- **API 错误码**: 401=Key无效, 403=权限不足, 429=限流, 500=服务端错误

## 功能指南

**Provider**: 设置→Provider→选服务商→填Key→点检查。自定义填OpenAI兼容端点。Copilot/CherryIN支持OAuth

**模型**: Provider页→获取模型拉列表。手动+输入ID。能力标签: vision/reasoning/function_calling/web_search

**知识库**: 知识库页→新建→选Embedding模型→导入文档(PDF/DOCX/TXT/MD/网页)→助手关联知识库

**Agent**: Agent页→+创建→选tool_calling模型(Claude/GPT-4o+)→权限(Normal/Plan/Auto-edit/Bypass)→Tools勾选MCP

**MCP**: 设置→MCP→添加Server。类型: stdio/SSE/Streamable HTTP。绿灯=连接，红灯=断开

**主题**: 设置→显示→自定义CSS。主题画廊: cherrycss.com。内置亮/暗+跟随系统

**版本更新**: `diagnose(check_update)` 检查→有新版导航到 `/settings/about`→GitHub不可达建议 cherry-ai.com

**数据备份**: 设置→数据管理。方式: 本地ZIP/WebDAV(坚果云等)/S3(AWS/MinIO/R2)/局域网传输。路径: macOS `~/Library/Application Support/cherry-studio/`, Windows `%LOCALAPPDATA%/cherry-studio/`, Linux `~/.config/cherry-studio/`

## 支持的 Provider（62+）

国际: OpenAI, Anthropic, Google Gemini, Azure, Mistral, Bedrock, VertexAI, GitHub Models/Copilot | 聚合: Cherry In, OpenRouter, AiHubMix, ocoolAI, PPIO, 302.AI, New API, Vercel AI | 国内: DeepSeek, 智谱, Moonshot, 百川, 通义, StepFun, 豆包, MiniMax, 混元, 百度云, ModelScope, Yi, MiMo | 本地: Ollama, LM Studio, OpenVINO, GPUStack | 加速: Groq, Together, Fireworks, Cerebras, Hyperbolic, SiliconFlow | 其他: Perplexity, Grok, Jina, HuggingFace, VoyageAI, Poe, nvidia | 支持任何 OpenAI 兼容端点

## 快捷键

Cmd/Ctrl + N 新建话题, +F 搜索, +Shift+F 全局搜索, +K 新上下文, +L 清空话题, +[ 助手列表, +] 话题列表, +Shift+M 选模型, +Shift+C 复制最后消息, +E 迷你窗口, +, 设置, +/-/0 缩放。自定义: 设置→快捷键

## 多语言

11种: 英/简中/繁中/日/法/德/西/葡/俄/罗马尼亚/希腊。切换: 设置→通用→语言

## 新手 FAQ

| 问 | 答 |
|----|-----|
| 第一次对话 | 首页选助手→选模型→发消息 |
| 怎么选模型 | 先配Provider(API Key)→聊天顶部选 |
| 免费模型 | Ollama本地免费; Copilot有免费额度 |
| Token | AI计量单位, ≈0.7中文字/4英文字符 |
| 对话历史 | 左侧话题列表, 自动保存本地 |
| 导出对话 | 话题右键→导出(MD/图片) |
| 数据安全 | 全部本地存储, Key本地加密 |
| MCP是什么 | 让AI调用外部工具(搜索/数据库/API等) |

## 反馈渠道

**Bug/需求提交**(推荐): 飞书表单 https://mcnnox2fhjfq.feishu.cn/share/base/form/shrcnkR1s45VDuFnV3GbD6VhnIJ

**GitHub**: Issues https://github.com/CherryHQ/cherry-studio/issues | Discussions https://github.com/CherryHQ/cherry-studio/discussions | 看板 https://github.com/orgs/CherryHQ/projects/7

**社群**: Discord https://discord.gg/wez8HtpxqQ | Telegram https://t.me/CherryStudioAI | X https://twitter.com/CherryStudioHQ | QQ群 575014769 | 论坛 linux.do

**官网**: cherry-ai.com | 中文文档 docs.cherry-ai.com | 主题 cherrycss.com | 邮箱 support@cherry-ai.com / bd@cherry-ai.com

中文用户推荐QQ群/linux.do/飞书表单, 国际用户推荐Discord/Telegram/GitHub

## GitHub CLI 引导

提交Issue前检测 `gh auth status`。未登录→告知安装 https://cli.github.com/ 后 `gh auth login`。不想配→记录本地+引导飞书表单/社区论坛

## 日志路径

macOS正式: ~/Library/Application Support/CherryStudio/logs/ | 开发: CherryStudioDev/logs/ | Windows: %APPDATA%/CherryStudio/logs/
