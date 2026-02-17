# 记忆功能 AI 集成增强设计

> 创建日期: 2025-02-16
> 状态: 设计完成，待实现

## 概述

本设计旨在增强 Cherry Studio 全局记忆功能的 AI 集成能力，让 AI 更智能地使用记忆信息。

## 需求优先级

| 优先级 | 功能 | 实现方式 |
|--------|------|----------|
| P1 | 主动回忆 | 用户控制开关，每次对话自动搜索 |
| P2 | 上下文注入 | 混合模式：高相关度→系统提示词，低相关度→工具调用 |
| P3 | 个性化回答 | 影响技术深度、语言、长度、代码风格 |
| P4 | 记忆推理 | 基于多条记忆推理新结论 |

## 架构设计

### 整体架构

```
┌────────────────────────────────────────────────────────────────┐
│                    onRequestStart 阶段                          │
│  1. 检测用户消息意图                                           │
│  2. 【新增】自动触发记忆搜索 (如果开关开启)                      │
│  3. 【新增】按相似度分类：高相关度 / 低相关度                    │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                    transformParams 阶段                         │
│  1. 【新增】高相关度记忆 → 注入系统提示词                       │
│  2. 低相关度记忆 → 保留 memorySearchTool 供 AI 调用             │
│  3. 【新增】注入个性化偏好提示词                                │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                    onRequestEnd 阶段                            │
│  (保持不变) 存储对话记忆、提取事实                              │
└────────────────────────────────────────────────────────────────┘
```

### 核心改动文件

| 文件 | 改动内容 |
|------|----------|
| `src/renderer/src/aiCore/plugins/searchOrchestrationPlugin.ts` | 增强 `onRequestStart` 和 `transformParams` |
| `src/renderer/src/utils/memory-prompts.ts` | 新增个性化提示词模板 |
| `src/renderer/src/store/memory.ts` | 新增配置项 |
| `src/renderer/src/types/index.ts` | 扩展 `MemoryConfig` 和新增类型 |

---

## 详细设计

### P1: 主动回忆

#### 功能目标

用户发消息时自动搜索相关记忆，无需 AI 主动调用工具。

#### 新增配置项

```typescript
// 扩展 MemoryConfig 类型
interface MemoryConfig {
  // 现有配置...

  // 新增配置
  autoRecallEnabled?: boolean      // 主动回忆开关，默认 true
  autoRecallLimit?: number         // 自动搜索返回数量，默认 5
  highRelevanceThreshold?: number  // 高相关度阈值，默认 0.8
}
```

#### 实现逻辑

```typescript
// searchOrchestrationPlugin.ts - onRequestStart 阶段新增
async function autoRecallMemories(
  userMessage: string,
  assistant: Assistant,
  config: MemoryProcessorConfig
): Promise<{ highRelevance: MemoryItem[], lowRelevance: MemoryItem[] }> {

  // 1. 检查开关
  if (!memoryConfig.autoRecallEnabled) {
    return { highRelevance: [], lowRelevance: [] }
  }

  // 2. 自动搜索记忆
  const memories = await memoryProcessor.searchRelevantMemories(
    userMessage,
    config,
    memoryConfig.autoRecallLimit || 5
  )

  // 3. 按相似度分类
  const threshold = memoryConfig.highRelevanceThreshold || 0.8
  return {
    highRelevance: memories.filter(m => (m.score || 0) >= threshold),
    lowRelevance: memories.filter(m => (m.score || 0) < threshold)
  }
}
```

#### 数据流

```
用户消息 → autoRecallMemories() → 分类结果
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
            score >= 0.8                         score < 0.8
           (高相关度)                            (低相关度)
                    │                                   │
                    ▼                                   ▼
           注入系统提示词                        保留工具调用
```

---

### P2: 上下文注入

#### 功能目标

高相关度记忆直接注入系统提示词，低相关度保留工具调用。

#### 系统提示词注入模板

```typescript
// memory-prompts.ts 新增
export const memoryContextPrompt: string = `以下是与用户相关的记忆信息，请在回答时参考：

{{ memoryItems }}

注意事项：
- 如果记忆与当前问题相关，请利用这些信息提供个性化回答
- 如果记忆与当前问题无关，请忽略这些信息
- 不要明确提及"根据记忆"或"我记得"，自然地使用信息即可`
```

#### 注入逻辑

```typescript
// searchOrchestrationPlugin.ts - transformParams 阶段
function injectMemoryToSystemPrompt(
  params: any,
  highRelevanceMemories: MemoryItem[]
): any {
  if (highRelevanceMemories.length === 0) {
    return params
  }

  // 格式化记忆内容
  const memoryText = highRelevanceMemories
    .map((m, i) => `${i + 1}. ${m.memory}`)
    .join('\n')

  const memoryContext = memoryContextPrompt.replace('{{ memoryItems }}', memoryText)

  // 注入到系统提示词
  if (params.system) {
    params.system = `${params.system}\n\n${memoryContext}`
  } else {
    params.system = memoryContext
  }

  return params
}
```

#### 效果对比

| 场景 | 处理方式 |
|------|----------|
| 用户问"我之前问过什么 Python 问题？" | 高相关度记忆直接注入，AI 无需调用工具 |
| 用户问"帮我写个函数" | 低相关度记忆通过工具，AI 按需搜索 |
| 两者混合 | 高相关度注入 + 低相关度工具可用 |

---

### P3: 个性化回答

#### 功能目标

根据记忆中的用户偏好，调整 AI 回答风格。

#### 偏好类型定义

```typescript
// types/index.ts 新增
interface UserPreference {
  type: 'technical_depth' | 'language' | 'response_length' | 'code_style'
  value: string
  source: string  // 来源记忆的 ID
}

// 偏好值枚举
type TechnicalDepth = 'beginner' | 'intermediate' | 'expert'
type ResponseLength = 'concise' | 'balanced' | 'detailed'
type CodeStyle = 'minimal' | 'commented' | 'documented'
```

#### 个性化提示词模板

```typescript
// memory-prompts.ts 新增
export const getPersonalizationPrompt = (preferences: UserPreference[]): string => {
  const techDepth = preferences.find(p => p.type === 'technical_depth')?.value
  const language = preferences.find(p => p.type === 'language')?.value
  const length = preferences.find(p => p.type === 'response_length')?.value
  const codeStyle = preferences.find(p => p.type === 'code_style')?.value

  let prompt = '请根据以下用户偏好调整你的回答风格：\n'

  if (techDepth === 'beginner') {
    prompt += '- 使用简单易懂的语言，避免专业术语，必要时解释概念\n'
  } else if (techDepth === 'expert') {
    prompt += '- 使用专业术语，可以直接深入技术细节\n'
  }

  if (length === 'concise') {
    prompt += '- 回答简洁，直接给出结论和关键信息\n'
  } else if (length === 'detailed') {
    prompt += '- 回答详细，提供充分的解释和示例\n'
  }

  if (codeStyle === 'commented') {
    prompt += '- 代码示例添加必要的注释\n'
  } else if (codeStyle === 'minimal') {
    prompt += '- 代码示例保持简洁，无需过多注释\n'
  }

  if (language) {
    prompt += `- 使用 ${language} 回答\n`
  }

  return prompt
}
```

#### 偏好提取逻辑

```typescript
// MemoryProcessor.ts 增强
async function extractUserPreferences(
  memories: MemoryItem[]
): Promise<UserPreference[]> {
  const preferences: UserPreference[] = []

  for (const memory of memories) {
    const text = memory.memory.toLowerCase()

    // 技术深度检测
    if (text.includes('新手') || text.includes('初学者')) {
      preferences.push({ type: 'technical_depth', value: 'beginner', source: memory.id })
    } else if (text.includes('专家') || text.includes('资深')) {
      preferences.push({ type: 'technical_depth', value: 'expert', source: memory.id })
    }

    // 回答长度检测
    if (text.includes('简洁') || text.includes('简短')) {
      preferences.push({ type: 'response_length', value: 'concise', source: memory.id })
    } else if (text.includes('详细') || text.includes('完整')) {
      preferences.push({ type: 'response_length', value: 'detailed', source: memory.id })
    }

    // 代码风格检测
    if (text.includes('注释') || text.includes('解释代码')) {
      preferences.push({ type: 'code_style', value: 'commented', source: memory.id })
    }
  }

  return preferences
}
```

#### 系统提示词结构

```
┌─────────────────────────────────────────┐
│ 原始系统提示词                           │
├─────────────────────────────────────────┤
│ 【新增】个性化偏好提示词                 │
├─────────────────────────────────────────┤
│ 【新增】高相关度记忆上下文               │
└─────────────────────────────────────────┘
```

---

### P4: 记忆推理

#### 功能目标

基于多条记忆推理出新结论（最低优先级，可作为后续迭代）。

#### 实现方案

后台异步推理，不阻塞对话。

```typescript
// 新增 MemoryInferenceService
class MemoryInferenceService {
  // 定期运行，分析记忆并生成推理结论
  async runInference(userId: string): Promise<void> {
    const memories = await this.getAllMemories(userId)

    // 使用 LLM 进行推理
    const inferences = await this.generateInferences(memories)

    // 将推理结论作为新记忆存储（标记来源为 inference）
    for (const inference of inferences) {
      await this.memoryService.add(inference, {
        userId,
        metadata: { source: 'inference', confidence: inference.confidence }
      })
    }
  }

  private async generateInferences(memories: MemoryItem[]): Promise<Inference[]> {
    // 调用 LLM 分析记忆，提取模式
  }
}
```

#### 推理提示词

```typescript
export const inferencePrompt = `分析以下用户记忆，找出潜在的关联和模式，生成推理结论：

<memories>
{{ memories }}
</memories>

请生成简洁的推理结论，例如：
- 如果用户多次使用某技术，可推断其职业或专长
- 如果用户多次表达某种偏好，可总结其总体偏好

返回 JSON 格式：
[
  { "conclusion": "推断结论", "confidence": 0.8, "basedOn": ["记忆ID1", "记忆ID2"] }
]
`
```

#### 配置项

```typescript
interface MemoryConfig {
  // ...现有配置

  // 推理配置
  inferenceEnabled?: boolean      // 推理开关，默认 false
  inferenceInterval?: number      // 触发间隔（对话次数），默认 10
}
```

---

## 实现计划

### 阶段一：P1 主动回忆

1. 扩展 `MemoryConfig` 类型
2. 修改 `searchOrchestrationPlugin.ts` 添加自动搜索逻辑
3. 添加 UI 配置开关

### 阶段二：P2 上下文注入

1. 添加 `memoryContextPrompt` 模板
2. 修改 `transformParams` 实现注入逻辑

### 阶段三：P3 个性化回答

1. 添加偏好类型定义
2. 添加个性化提示词模板
3. 实现偏好提取逻辑

### 阶段四：P4 记忆推理（可选）

1. 创建 `MemoryInferenceService`
2. 添加推理提示词
3. 实现后台推理触发机制

---

## 风险与注意事项

1. **性能影响**：自动搜索会增加每次请求的延迟，需要控制搜索数量
2. **隐私考虑**：注入系统提示词的记忆可能被日志记录
3. **提示词长度**：过多记忆会占用上下文长度，需要设置上限
4. **推理准确性**：自动推理可能产生错误结论，需要置信度机制
