# phase6 测试补齐与收尾

共享约束见 [plans/README.md](./README.md)。

## 目标

在 Knowledge V2 主结构稳定后，再统一补测试、收文档、清理残留实现。

## 建议落位文件

- `src/renderer/src/pages/knowledge.v2/components/__tests__/`
- `src/renderer/src/pages/knowledge.v2/panels/**/__tests__/`
- `src/renderer/src/pages/knowledge.v2/hooks/__tests__/`
- 相关开发文档和迁移说明

## 范围

- 页面级组件测试。
- panel 级交互测试。
- hooks 编排测试。
- 文档补全和残留代码清理。

## 非目标

- 不在 phase6 再回头重做结构分层。
- 不把测试范围无限扩张到所有旧知识库历史逻辑。

## 具体任务

1. 为页面级结构组件补基础渲染和交互测试。
2. 为数据源、RAG 配置、召回测试三个 panel 补关键行为测试。
3. 为 V2 hooks 补数据编排测试。
4. 清理 phase1 到 phase5 中遗留的无用占位文件和过时说明。
5. 补充最终开发文档，明确 V2 的入口和边界。

## 约束

- 测试只覆盖 V2 的现行主实现，不为即将删除的旧页面补新测试。
- 测试优先覆盖结构稳定、用户可见、容易回归的关键行为。
- 文档必须反映最终目录和入口，不能保留过时结构说明。
- 本阶段完成后，再执行完整 lint/test/format 验证流程。

## 完成标志

- Knowledge V2 的核心结构和关键交互有测试覆盖。
- 文档和实际目录一致。
- 旧实现残留被收敛到可控范围。
