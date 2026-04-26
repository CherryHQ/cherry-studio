# Knowledge V2 TODO

## 后续完善项

- [ ] 恢复聊天前知识库检索 prompt 注入能力，使用 Knowledge V2 的 DataApi / runtime 边界替代旧 `KnowledgeV2Service`。
- [ ] 恢复内置知识库搜索工具的 V2 检索逻辑，并统一引用结果的数据结构和引用编号生成规则。
- [ ] 恢复知识库工具结果的后处理能力，支持将视频等特殊知识库引用转换为对应的消息 chunk。
- [ ] 恢复 assistant preset 弹窗中的知识库列表加载，并直接消费 V2 知识库数据结构。
- [ ] 恢复 assistant 设置页中的知识库列表加载和选择保存逻辑，并移除旧版 `KnowledgeBase` 兼容转换。
- [ ] 恢复输入栏知识库选择按钮中的知识库列表加载，并使用共享的 V2 knowledge base hook。
- [ ] 恢复从知识库选择附件文件的能力，基于 V2 item list API 加载文件类型条目。
- [ ] 恢复保存笔记、消息内容和附件到 V2 知识库的能力，复用 V2 添加来源 hook / runtime 流程。
- [ ] 补齐 Knowledge V2 与 AI Core 的架构文档，说明检索、引用注入、工具调用和保存入口的数据流。
- [ ] 为上述恢复路径补齐针对性测试，覆盖聊天注入、工具搜索、知识库选择、附件选择和保存到知识库。
