# 02_Architecture — 架构与契约

源码地图、模块说明、数据模型、API 契约等**长期参考文档**。这些文件是任务的产物，但被设计为「读到的人不需要知道是哪次任务写的」。

## 文件

| 文件 | 主题 |
|---|---|
| [源码地图.md](./源码地图.md) | 顶层组件树、目录结构、关键路径速查 |
| [模块说明.md](./模块说明.md) | UI / 状态 / 持久化 / AI 调用 / Hook / 共享包 各模块职责与依赖 |
| [数据模型.md](./数据模型.md) | Message / Topic / Block / Assistant 在 v1 与 v2 的字段对照 |
| [DataApi端点.md](./DataApi端点.md) | 13 个聊天端点 + renderer 实际消费分工 + 缺口清单 |
| [分支对话.md](./分支对话.md) | branch chat v2 实现现状（schema ✅ / service ✅ / UI ❌） |
| [服务算法.md](./服务算法.md) | main 端 MessageService / TopicService 等核心算法（getTree / cursor 分页 / fork） |
| [事件与IPC.md](./事件与IPC.md) | renderer EventEmitter 全表 + main↔renderer IPC channel |

## 阅读顺序建议

1. 先读 [源码地图.md](./源码地图.md) —— 顶层全景
2. 再读 [模块说明.md](./模块说明.md) —— 模块边界
3. 按需深入：写后端 → [服务算法.md](./服务算法.md) / [DataApi端点.md](./DataApi端点.md)；写前端 UI → [分支对话.md](./分支对话.md) / [事件与IPC.md](./事件与IPC.md)
