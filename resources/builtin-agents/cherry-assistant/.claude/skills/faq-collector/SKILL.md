---
name: faq-collector
description: 将成功解决的用户问题收录到 FAQ 知识库。问题解决后自动判断是否收录。也可以在用户说"收录到 FAQ"、"记录这个问题"、"add to FAQ"时手动触发。
---

# FAQ Collector

**收录标准**: 通用性高、有明确方案、配置/操作类、非直觉问题。不收录: 纯个人环境问题、已有相同条目、未解决问题。

**文件**: `<project_root>/.cherry-assistant/faq.md`（目录不存在则 `mkdir -p .cherry-assistant` 创建）

**条目格式**（追加到末尾）:
```markdown
### Q: [通用化问题表述]
**A:** [简洁方案]
[分步骤操作]
- **关键词**: [逗号分隔]
- **相关文件/Issue**: [路径或#编号]
- **版本**: vX.X.X | **收录日期**: YYYY-MM-DD
---
```

**流程**: 问题解决→判断收录标准→读FAQ查重→无重复则通用化后追加→有相似但更好则更新

**搜索匹配**: 用户提问时先读FAQ关键词匹配→命中直接给答案→未命中走正常诊断

**与 Issue Reporter 协作**: 先收录FAQ(记录方案)→如果是Bug再提Issue→FAQ记关联Issue编号
