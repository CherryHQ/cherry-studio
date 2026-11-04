---
icon: book-open
---

# 构建知识库与召回测试

完整的“创建 → 导入 → 测试 → 使用”流程统一见[知识库入门](../../knowledge-base/knowledge-base.md)。本页帮助你从进阶工作流跳到对应步骤。

## 新建并导入资料

按当前进度选择下面的步骤；第一次使用请从创建知识库开始。

### 1. 打开【知识库】→【新建知识库】

见[创建知识库](../../knowledge-base/create.md)。嵌入模型不是必选项，可以先用关键词检索跑通流程，再按需加入嵌入模型。

### 2. 选择资料来源

文件、目录、笔记和链接的导入方式见[添加与整理资料](../../knowledge-base/sources.md)；扫描件先看[文档预处理](../../knowledge-base/document-preprocessing.md)。

### 3. 等待处理完成

抽查正文和 Chunks 是否缺失或乱码，验收步骤见[检查资料与召回](../../knowledge-base/recall-test.md)。

### 4. 做召回测试

用已知答案的真实问题检查来源和完整上下文，按[召回测试](../../knowledge-base/recall-test.md)验收后再绑定智能体。

### 用真实问题验收召回结果

导入完成不代表可以直接使用：结果中需要有正确来源，以及回答所需的条件与结论。没有结果、片段截断或命中过期资料时，按[召回指南](../../knowledge-base/recall-test.md)定位问题。

## RAG 设置怎么理解

嵌入、重排、Top K 和分块统一见[模型与检索设置](../../knowledge-base/emb-models-info.md)。每次只调整一项并用同一组问题复测；分块设置改变后，已有资料需要重新索引。

### 应用案例：建立内部制度问答库

把现行制度整理到同一资料范围，用真实问题测试，确认来源后再交给智能体。完整工作流见[知识库应用案例](../../knowledge-base/cases.md)和[与智能体一起使用](../../knowledge-base/agent.md)。制度变化时更新或移除旧资料，再重复召回测试。

<details>

<summary>为什么导入后一直没有结果？</summary>

先检查处理状态和解析正文；配置了嵌入模型时，再检查模型连接。按[知识库排错](../../knowledge-base/troubleshooting.md)定位具体环节。

</details>
