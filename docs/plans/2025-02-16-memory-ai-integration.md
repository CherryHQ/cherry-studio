# Memory AI Integration Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance Cherry Studio's memory feature to enable automatic memory recall, context injection, and personalized responses.

**Architecture:** Extend the existing `searchOrchestrationPlugin` to add auto-recall and context injection. Add personalization prompt templates and preference extraction logic. Use hybrid mode: high-relevance memories injected to system prompt, low-relevance via tool calls.

**Tech Stack:** TypeScript, React, Redux Toolkit, Vitest

---

## Phase 1: P1 - Auto Recall

### Task 1.1: Extend MemoryConfig Type

**Files:**
- Modify: `src/renderer/src/types/index.ts`

**Step 1: Add new config properties to MemoryConfig interface**

Find the `MemoryConfig` interface and add:

```typescript
interface MemoryConfig {
  // ... existing properties
  embeddingDimensions?: number
  embeddingModel?: Model
  llmModel?: Model
  embeddingApiClient?: ApiClient
  customFactExtractionPrompt?: string
  customUpdateMemoryPrompt?: string
  isAutoDimensions?: boolean

  // NEW: Auto recall config
  autoRecallEnabled?: boolean      // Auto recall switch, default true
  autoRecallLimit?: number         // Max memories to return, default 5
  highRelevanceThreshold?: number  // High relevance threshold, default 0.8
}
```

**Step 2: Run type check**

Run: `pnpm build:check`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/renderer/src/types/index.ts
git commit -m "feat(memory): add auto recall config types"
```

---

### Task 1.2: Update Default Memory Config

**Files:**
- Modify: `src/renderer/src/store/memory.ts`

**Step 1: Update defaultMemoryConfig**

Find `defaultMemoryConfig` and add defaults:

```typescript
const defaultMemoryConfig: MemoryConfig = {
  embeddingDimensions: undefined,
  isAutoDimensions: true,
  customFactExtractionPrompt: factExtractionPrompt,
  customUpdateMemoryPrompt: updateMemorySystemPrompt,
  // NEW: Auto recall defaults
  autoRecallEnabled: true,
  autoRecallLimit: 5,
  highRelevanceThreshold: 0.8
}
```

**Step 2: Run type check**

Run: `pnpm build:check`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/renderer/src/store/memory.ts
git commit -m "feat(memory): add auto recall default config"
```

---

### Task 1.3: Add Auto Recall Logic to Plugin

**Files:**
- Modify: `src/renderer/src/aiCore/plugins/searchOrchestrationPlugin.ts`

**Step 1: Add memory classification storage**

Add at the top of the plugin function (around line 241):

```typescript
export const searchOrchestrationPlugin = (assistant: Assistant, topicId: string) => {
  // Existing storage
  const intentAnalysisResults: { [requestId: string]: ExtractResults } = {}
  const userMessages: { [requestId: string]: ModelMessage } = {}

  // NEW: Store classified memories
  const classifiedMemories: {
    [requestId: string]: { highRelevance: MemoryItem[]; lowRelevance: MemoryItem[] }
  } = {}

  // ... rest of plugin
}
```

**Step 2: Add import for MemoryItem**

Add to imports at the top:

```typescript
import type { MemoryItem } from '@renderer/types'
```

**Step 3: Add autoRecallMemories function**

Add this function before `searchOrchestrationPlugin`:

```typescript
/**
 * Auto recall memories and classify by relevance
 */
async function autoRecallMemories(
  userMessage: string,
  assistant: Assistant,
  config: MemoryProcessorConfig,
  memoryConfig: MemoryConfig
): Promise<{ highRelevance: MemoryItem[]; lowRelevance: MemoryItem[] }> {
  // Check if auto recall is enabled
  if (!memoryConfig.autoRecallEnabled) {
    return { highRelevance: [], lowRelevance: [] }
  }

  try {
    const memoryProcessor = new MemoryProcessor()
    const memories = await memoryProcessor.searchRelevantMemories(
      userMessage,
      config,
      memoryConfig.autoRecallLimit || 5
    )

    // Classify by relevance score
    const threshold = memoryConfig.highRelevanceThreshold || 0.8
    return {
      highRelevance: memories.filter((m) => (m.score || 0) >= threshold),
      lowRelevance: memories.filter((m) => (m.score || 0) < threshold)
    }
  } catch (error) {
    logger.error('Auto recall failed:', error as Error)
    return { highRelevance: [], lowRelevance: [] }
  }
}
```

**Step 4: Add import for MemoryConfig**

Add to imports:

```typescript
import type { MemoryConfig } from '@renderer/types'
```

**Step 5: Call autoRecallMemories in onRequestStart**

In `onRequestStart`, after the memory search check, add the auto recall call:

```typescript
onRequestStart: async (context: AiRequestContext) => {
  // ... existing code until line 273

  const shouldMemorySearch = globalMemoryEnabled && assistant.enableMemory

  // NEW: Auto recall memories if enabled
  if (shouldMemorySearch) {
    const memoryConfig = selectMemoryConfig(store.getState())
    const currentUserId = selectCurrentUserId(store.getState())
    const processorConfig = MemoryProcessor.getProcessorConfig(
      memoryConfig,
      assistant.id,
      currentUserId,
      context.requestId
    )

    const userMessageContent = getMessageContent(lastUserMessage) || ''
    const classified = await autoRecallMemories(
      userMessageContent,
      assistant,
      processorConfig,
      memoryConfig
    )
    classifiedMemories[context.requestId] = classified

    logger.debug('Auto recalled memories:', {
      high: classified.highRelevance.length,
      low: classified.lowRelevance.length
    })
  }

  // ... rest of existing code (intent analysis)
}
```

**Step 6: Run type check**

Run: `pnpm build:check`
Expected: No type errors

**Step 7: Commit**

```bash
git add src/renderer/src/aiCore/plugins/searchOrchestrationPlugin.ts
git commit -m "feat(memory): add auto recall logic to searchOrchestrationPlugin"
```

---

### Task 1.4: Add Memory Context Prompt Template

**Files:**
- Modify: `src/renderer/src/utils/memory-prompts.ts`

**Step 1: Add memoryContextPrompt**

Add after the existing prompts:

```typescript
export const memoryContextPrompt: string = `以下是与用户相关的记忆信息，请在回答时参考：

{{ memoryItems }}

注意事项：
- 如果记忆与当前问题相关，请利用这些信息提供个性化回答
- 如果记忆与当前问题无关，请忽略这些信息
- 不要明确提及"根据记忆"或"我记得"，自然地使用信息即可`
```

**Step 2: Add helper function to format memory prompt**

Add at the end of the file:

```typescript
export function getMemoryContextPrompt(memories: MemoryItem[]): string {
  if (memories.length === 0) {
    return ''
  }

  const memoryText = memories.map((m, i) => `${i + 1}. ${m.memory}`).join('\n')
  return memoryContextPrompt.replace('{{ memoryItems }}', memoryText)
}
```

**Step 3: Add MemoryItem import**

Add at the top:

```typescript
import type { MemoryItem } from '@types'
```

**Step 4: Run type check**

Run: `pnpm build:check`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/renderer/src/utils/memory-prompts.ts
git commit -m "feat(memory): add memory context prompt template"
```

---

## Phase 2: P2 - Context Injection

### Task 2.1: Implement Context Injection in Plugin

**Files:**
- Modify: `src/renderer/src/aiCore/plugins/searchOrchestrationPlugin.ts`

**Step 1: Add import for getMemoryContextPrompt**

Add to imports:

```typescript
import { getMemoryContextPrompt } from '@renderer/utils/memory-prompts'
```

**Step 2: Add context injection in transformParams**

In `transformParams`, before the memory search tool check, add:

```typescript
transformParams: async (params: any, context: AiRequestContext) => {
  try {
    // ... existing code

    // NEW: Inject high relevance memories to system prompt
    const classified = classifiedMemories[context.requestId]
    if (classified?.highRelevance.length > 0) {
      const memoryContext = getMemoryContextPrompt(classified.highRelevance)
      if (params.system) {
        params.system = `${params.system}\n\n${memoryContext}`
      } else {
        params.system = memoryContext
      }
      logger.debug('Injected high relevance memories to system prompt')
    }

    // ... existing code (web search, knowledge search tools)
```

**Step 2: Update memory search tool condition**

Change the memory search tool addition to only add for low relevance:

```typescript
    // Memory search tool - only for low relevance memories
    if (globalMemoryEnabled && assistant.enableMemory) {
      // Only add tool if there are low relevance memories or if auto recall is disabled
      const hasLowRelevance = classified?.lowRelevance.length > 0
      const autoRecallDisabled = !selectMemoryConfig(store.getState()).autoRecallEnabled

      if (hasLowRelevance || autoRecallDisabled) {
        params.tools['builtin_memory_search'] = memorySearchTool()
      }
    }
```

**Step 3: Cleanup classified memories in onRequestEnd**

In `onRequestEnd`, add cleanup:

```typescript
onRequestEnd: async (context: AiRequestContext) => {
  try {
    // ... existing code

    // Cleanup
    delete intentAnalysisResults[context.requestId]
    delete userMessages[context.requestId]
    delete classifiedMemories[context.requestId]  // NEW
  } catch (error) {
    // ... existing code
  }
}
```

**Step 4: Run type check**

Run: `pnpm build:check`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/renderer/src/aiCore/plugins/searchOrchestrationPlugin.ts
git commit -m "feat(memory): implement context injection for high relevance memories"
```

---

## Phase 3: P3 - Personalized Responses

### Task 3.1: Add User Preference Types

**Files:**
- Modify: `src/renderer/src/types/index.ts`

**Step 1: Add UserPreference interface**

Add after `MemoryConfig`:

```typescript
// User preference types for personalized responses
export type TechnicalDepth = 'beginner' | 'intermediate' | 'expert'
export type ResponseLength = 'concise' | 'balanced' | 'detailed'
export type CodeStyle = 'minimal' | 'commented' | 'documented'

export interface UserPreference {
  type: 'technical_depth' | 'language' | 'response_length' | 'code_style'
  value: string
  source: string // Source memory ID
}
```

**Step 2: Run type check**

Run: `pnpm build:check`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/renderer/src/types/index.ts
git commit -m "feat(memory): add user preference types for personalization"
```

---

### Task 3.2: Add Personalization Prompt Template

**Files:**
- Modify: `src/renderer/src/utils/memory-prompts.ts`

**Step 1: Add getPersonalizationPrompt function**

Add at the end of the file:

```typescript
export function getPersonalizationPrompt(preferences: UserPreference[]): string {
  if (preferences.length === 0) {
    return ''
  }

  const techDepth = preferences.find((p) => p.type === 'technical_depth')?.value
  const language = preferences.find((p) => p.type === 'language')?.value
  const length = preferences.find((p) => p.type === 'response_length')?.value
  const codeStyle = preferences.find((p) => p.type === 'code_style')?.value

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

**Step 2: Add UserPreference import**

Add to imports:

```typescript
import type { UserPreference } from '@types'
```

**Step 3: Run type check**

Run: `pnpm build:check`
Expected: No type errors

**Step 4: Commit**

```bash
git add src/renderer/src/utils/memory-prompts.ts
git commit -m "feat(memory): add personalization prompt template"
```

---

### Task 3.3: Add Preference Extraction to MemoryProcessor

**Files:**
- Modify: `src/renderer/src/services/MemoryProcessor.ts`

**Step 1: Add extractUserPreferences method**

Add as a new method in the `MemoryProcessor` class:

```typescript
/**
 * Extract user preferences from memories
 * @param memories - Array of memory items to analyze
 * @returns Array of extracted user preferences
 */
extractUserPreferences(memories: MemoryItem[]): UserPreference[] {
  const preferences: UserPreference[] = []

  for (const memory of memories) {
    const text = memory.memory.toLowerCase()

    // Technical depth detection
    if (text.includes('新手') || text.includes('初学者') || text.includes('入门')) {
      preferences.push({ type: 'technical_depth', value: 'beginner', source: memory.id })
    } else if (text.includes('专家') || text.includes('资深') || text.includes('高级')) {
      preferences.push({ type: 'technical_depth', value: 'expert', source: memory.id })
    }

    // Response length detection
    if (text.includes('简洁') || text.includes('简短') || text.includes('简单')) {
      preferences.push({ type: 'response_length', value: 'concise', source: memory.id })
    } else if (text.includes('详细') || text.includes('完整') || text.includes('全面')) {
      preferences.push({ type: 'response_length', value: 'detailed', source: memory.id })
    }

    // Code style detection
    if (text.includes('注释') || text.includes('解释代码')) {
      preferences.push({ type: 'code_style', value: 'commented', source: memory.id })
    } else if (text.includes('简洁代码') || text.includes('无注释')) {
      preferences.push({ type: 'code_style', value: 'minimal', source: memory.id })
    }

    // Language detection (Chinese vs English)
    if (text.includes('中文回答') || text.includes('用中文')) {
      preferences.push({ type: 'language', value: '中文', source: memory.id })
    } else if (text.includes('英文回答') || text.includes('用英文')) {
      preferences.push({ type: 'language', value: 'English', source: memory.id })
    }
  }

  return preferences
}
```

**Step 2: Add UserPreference import**

Add to imports:

```typescript
import type { UserPreference } from '@renderer/types'
```

**Step 3: Run type check**

Run: `pnpm build:check`
Expected: No type errors

**Step 4: Commit**

```bash
git add src/renderer/src/services/MemoryProcessor.ts
git commit -m "feat(memory): add user preference extraction to MemoryProcessor"
```

---

### Task 3.4: Integrate Personalization in Plugin

**Files:**
- Modify: `src/renderer/src/aiCore/plugins/searchOrchestrationPlugin.ts`

**Step 1: Add import for getPersonalizationPrompt**

Add to imports:

```typescript
import { getMemoryContextPrompt, getPersonalizationPrompt } from '@renderer/utils/memory-prompts'
```

**Step 2: Update context injection to include personalization**

Modify the context injection section in `transformParams`:

```typescript
    // Inject high relevance memories to system prompt
    const classified = classifiedMemories[context.requestId]
    if (classified?.highRelevance.length > 0) {
      // Extract user preferences
      const memoryProcessor = new MemoryProcessor()
      const preferences = memoryProcessor.extractUserPreferences(classified.highRelevance)
      const personalizationPrompt = getPersonalizationPrompt(preferences)
      const memoryContext = getMemoryContextPrompt(classified.highRelevance)

      // Build combined system prompt
      let additionalContext = ''
      if (personalizationPrompt) {
        additionalContext += personalizationPrompt + '\n\n'
      }
      if (memoryContext) {
        additionalContext += memoryContext
      }

      if (params.system) {
        params.system = `${params.system}\n\n${additionalContext}`
      } else {
        params.system = additionalContext
      }

      logger.debug('Injected memories and personalization to system prompt', {
        memoryCount: classified.highRelevance.length,
        preferenceCount: preferences.length
      })
    }
```

**Step 3: Run type check**

Run: `pnpm build:check`
Expected: No type errors

**Step 4: Commit**

```bash
git add src/renderer/src/aiCore/plugins/searchOrchestrationPlugin.ts
git commit -m "feat(memory): integrate personalization in context injection"
```

---

## Phase 4: Testing

### Task 4.1: Add Unit Tests for Memory Prompts

**Files:**
- Create: `src/renderer/src/utils/__tests__/memory-prompts.test.ts`

**Step 1: Create test file**

```typescript
import { describe, expect, it } from 'vitest'
import type { MemoryItem, UserPreference } from '@renderer/types'
import { getMemoryContextPrompt, getPersonalizationPrompt } from '../memory-prompts'

describe('memory-prompts', () => {
  describe('getMemoryContextPrompt', () => {
    it('returns empty string for empty memories', () => {
      expect(getMemoryContextPrompt([])).toBe('')
    })

    it('formats single memory correctly', () => {
      const memories: MemoryItem[] = [{ id: '1', memory: 'User likes Python', score: 0.9 }]
      const result = getMemoryContextPrompt(memories)
      expect(result).toContain('1. User likes Python')
      expect(result).toContain('与用户相关的记忆信息')
    })

    it('formats multiple memories correctly', () => {
      const memories: MemoryItem[] = [
        { id: '1', memory: 'User likes Python', score: 0.9 },
        { id: '2', memory: 'User is a developer', score: 0.85 }
      ]
      const result = getMemoryContextPrompt(memories)
      expect(result).toContain('1. User likes Python')
      expect(result).toContain('2. User is a developer')
    })
  })

  describe('getPersonalizationPrompt', () => {
    it('returns empty string for empty preferences', () => {
      expect(getPersonalizationPrompt([])).toBe('')
    })

    it('adds beginner technical depth instruction', () => {
      const preferences: UserPreference[] = [
        { type: 'technical_depth', value: 'beginner', source: '1' }
      ]
      const result = getPersonalizationPrompt(preferences)
      expect(result).toContain('简单易懂的语言')
      expect(result).toContain('避免专业术语')
    })

    it('adds expert technical depth instruction', () => {
      const preferences: UserPreference[] = [
        { type: 'technical_depth', value: 'expert', source: '1' }
      ]
      const result = getPersonalizationPrompt(preferences)
      expect(result).toContain('专业术语')
    })

    it('adds concise response length instruction', () => {
      const preferences: UserPreference[] = [
        { type: 'response_length', value: 'concise', source: '1' }
      ]
      const result = getPersonalizationPrompt(preferences)
      expect(result).toContain('简洁')
    })

    it('adds detailed response length instruction', () => {
      const preferences: UserPreference[] = [
        { type: 'response_length', value: 'detailed', source: '1' }
      ]
      const result = getPersonalizationPrompt(preferences)
      expect(result).toContain('详细')
    })

    it('combines multiple preferences', () => {
      const preferences: UserPreference[] = [
        { type: 'technical_depth', value: 'beginner', source: '1' },
        { type: 'response_length', value: 'concise', source: '2' }
      ]
      const result = getPersonalizationPrompt(preferences)
      expect(result).toContain('简单易懂')
      expect(result).toContain('简洁')
    })
  })
})
```

**Step 2: Run tests**

Run: `pnpm test:renderer -- --run memory-prompts.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/renderer/src/utils/__tests__/memory-prompts.test.ts
git commit -m "test(memory): add unit tests for memory prompt utilities"
```

---

### Task 4.2: Add Unit Tests for Preference Extraction

**Files:**
- Create: `src/renderer/src/services/__tests__/MemoryProcessor.preference.test.ts`

**Step 1: Create test file**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoryItem } from '@renderer/types'
import { MemoryProcessor } from '../MemoryProcessor'

// Mock dependencies
vi.mock('../MemoryService', () => ({
  default: {
    getInstance: vi.fn(() => ({
      add: vi.fn(),
      search: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    }))
  }
}))

describe('MemoryProcessor - extractUserPreferences', () => {
  let processor: MemoryProcessor

  beforeEach(() => {
    processor = new MemoryProcessor()
  })

  it('returns empty array for empty memories', () => {
    expect(processor.extractUserPreferences([])).toEqual([])
  })

  it('detects beginner technical depth', () => {
    const memories: MemoryItem[] = [
      { id: '1', memory: '我是编程新手' }
    ]
    const result = processor.extractUserPreferences(memories)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('technical_depth')
    expect(result[0].value).toBe('beginner')
  })

  it('detects expert technical depth', () => {
    const memories: MemoryItem[] = [
      { id: '1', memory: '我是一名资深开发者' }
    ]
    const result = processor.extractUserPreferences(memories)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('technical_depth')
    expect(result[0].value).toBe('expert')
  })

  it('detects concise response preference', () => {
    const memories: MemoryItem[] = [
      { id: '1', memory: '我喜欢简洁的回答' }
    ]
    const result = processor.extractUserPreferences(memories)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('response_length')
    expect(result[0].value).toBe('concise')
  })

  it('detects detailed response preference', () => {
    const memories: MemoryItem[] = [
      { id: '1', memory: '请给我详细的解释' }
    ]
    const result = processor.extractUserPreferences(memories)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('response_length')
    expect(result[0].value).toBe('detailed')
  })

  it('detects commented code style', () => {
    const memories: MemoryItem[] = [
      { id: '1', memory: '代码要有注释' }
    ]
    const result = processor.extractUserPreferences(memories)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('code_style')
    expect(result[0].value).toBe('commented')
  })

  it('detects minimal code style', () => {
    const memories: MemoryItem[] = [
      { id: '1', memory: '代码要简洁代码' }
    ]
    const result = processor.extractUserPreferences(memories)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('code_style')
    expect(result[0].value).toBe('minimal')
  })

  it('detects Chinese language preference', () => {
    const memories: MemoryItem[] = [
      { id: '1', memory: '请用中文回答' }
    ]
    const result = processor.extractUserPreferences(memories)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('language')
    expect(result[0].value).toBe('中文')
  })

  it('extracts multiple preferences from single memory', () => {
    const memories: MemoryItem[] = [
      { id: '1', memory: '我是新手，请给我简洁的回答' }
    ]
    const result = processor.extractUserPreferences(memories)
    expect(result).toHaveLength(2)
    const types = result.map((p) => p.type)
    expect(types).toContain('technical_depth')
    expect(types).toContain('response_length')
  })
})
```

**Step 2: Run tests**

Run: `pnpm test:renderer -- --run MemoryProcessor.preference.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/renderer/src/services/__tests__/MemoryProcessor.preference.test.ts
git commit -m "test(memory): add unit tests for preference extraction"
```

---

## Phase 5: Final Verification

### Task 5.1: Run Full Test Suite

**Step 1: Run all tests**

Run: `pnpm test`
Expected: All tests pass

**Step 2: Run lint and type check**

Run: `pnpm build:check`
Expected: No errors

**Step 3: Run format**

Run: `pnpm format`
Expected: Files formatted

---

### Task 5.2: Final Commit (if needed)

```bash
git add -A
git status
# Review any remaining changes
git commit -m "feat(memory): complete AI integration enhancement"
```

---

## Summary

This implementation plan covers:

1. **P1 Auto Recall** - Automatic memory search with user control
2. **P2 Context Injection** - High-relevance memories injected to system prompt
3. **P3 Personalized Responses** - User preferences affect AI response style

**Key Files Modified:**
- `src/renderer/src/types/index.ts` - New types
- `src/renderer/src/store/memory.ts` - Default config
- `src/renderer/src/aiCore/plugins/searchOrchestrationPlugin.ts` - Core logic
- `src/renderer/src/utils/memory-prompts.ts` - Prompt templates
- `src/renderer/src/services/MemoryProcessor.ts` - Preference extraction

**P4 Memory Inference** is marked as optional and can be implemented in a future iteration.
