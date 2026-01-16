# Agent Framework Comparison

## Overview

| Aspect | Cherry Studio aiCore | btcp-ai-agents |
|--------|---------------------|----------------|
| **Package Name** | `@cherrystudio/ai-core` | `@waiboard/ai-agents` |
| **Primary Purpose** | Multi-provider AI SDK abstraction | Canvas-oriented agentic execution |
| **Architecture Pattern** | Two-layer (Models + Runtime) | TOAD Loop (Think-Act-Observe-Decide) |
| **Design Philosophy** | Function-first, minimal wrapping | Structured agentic cycles |
| **Execution Model** | Request/Response with plugins | Iterative agent loop |

---

## Architecture Comparison

### Cherry Studio aiCore

```
┌─────────────────────────────────────────────┐
│              User API Layer                  │
│  (streamText, generateText, createExecutor)  │
├─────────────────────────────────────────────┤
│           Runtime Layer                      │
│  RuntimeExecutor ← PluginEngine              │
│                  ← PluginManager             │
├─────────────────────────────────────────────┤
│           Models Layer                       │
│  ModelResolver → RegistryManagement          │
│              → Provider Registry             │
├─────────────────────────────────────────────┤
│        Vercel AI SDK Foundation              │
│  (LanguageModelV2, Provider Implementations) │
└─────────────────────────────────────────────┘
```

**Key Components:**
- **ModelResolver**: Converts model IDs to `LanguageModelV2` instances
- **PluginEngine**: Orchestrates plugin lifecycle during execution
- **RuntimeExecutor**: User-facing API with `streamText()`, `generateText()`, etc.
- **RegistryManagement**: Central provider storage and resolution

### btcp-ai-agents

```
┌─────────────────────────────────────────────┐
│          Orchestration Layer                 │
│  (Aliases, Skills, Context, Hooks)           │
├─────────────────────────────────────────────┤
│             TOAD Loop                        │
│  ┌─────┐ → ┌─────┐ → ┌─────────┐ → ┌──────┐ │
│  │THINK│   │ ACT │   │ OBSERVE │   │DECIDE│ │
│  └─────┘ ← └─────┘ ← └─────────┘ ← └──────┘ │
├─────────────────────────────────────────────┤
│           Core Resources                     │
│  Providers │ Tools │ Skills │ MCP Client     │
├─────────────────────────────────────────────┤
│          Infrastructure                      │
│  Context Managers │ Platform Adapters        │
└─────────────────────────────────────────────┘
```

**TOAD Phases:**
1. **THINK**: Gather context, build canvas awareness, inject skills
2. **ACT**: Execute tool calls through MCP clients
3. **OBSERVE**: Process results, validate state changes
4. **DECIDE**: Continue, complete, fail, or timeout

---

## Provider Support

| Provider | aiCore | btcp-ai-agents |
|----------|--------|----------------|
| OpenAI | ✅ | ✅ |
| Anthropic | ✅ | ✅ |
| Google/Gemini | ✅ | ✅ (primary for images) |
| Azure | ✅ | ❌ |
| AWS Bedrock | ✅ | ❌ |
| xAI/Grok | ✅ | ❌ |
| DeepSeek | ✅ | ❌ |
| Groq | ✅ | ❌ |
| Mistral | ✅ | ❌ |
| Ollama | ✅ | ❌ |
| OpenAI-compatible | ✅ | ❌ |

**Summary**: aiCore supports 19+ providers via Vercel AI SDK adapters; btcp-ai-agents focuses on 3 major providers (Google, OpenAI, Anthropic).

---

## Plugin/Extension System

### aiCore Plugin Hooks

Three categories inspired by Rollup:

| Hook Type | Hooks | Behavior |
|-----------|-------|----------|
| **First** | `resolveModel`, `loadTemplate` | First valid result wins |
| **Sequential** | `configureContext`, `transformParams`, `transformResult` | Data transformation pipeline |
| **Parallel** | `onRequestStart`, `onRequestEnd`, `onError` | Side effects, fire-and-forget |
| **Stream** | `transformStream` | Direct stream transformation |

**Plugin Enforcement:**
- `enforce: 'pre'` - Before normal plugins
- `enforce: 'post'` - After normal plugins

### btcp-ai-agents Extension Points

| Extension | Purpose |
|-----------|---------|
| **Skills** | Pluggable, composable skill registration |
| **Hooks** | Lifecycle observability and metrics |
| **Aliases** | Command preprocessing |
| **Adapters** | Action execution abstraction |

---

## Tool Calling

### aiCore Approach

1. **Native Function Calling**: Uses provider's native tool calling when available
2. **Prompt-Based Fallback**: For models without native support, uses XML tag extraction:

```xml
<tool_use>
  <name>search</name>
  <arguments>{"query": "example"}</arguments>
</tool_use>
```

Components:
- `TagExtraction` - Parses XML-style tool tags
- `ToolExecutor` - Validates and executes tools
- `StreamEventManager` - Manages tool call events in streams

### btcp-ai-agents Approach

1. **5-Tool Canvas API**:
   - Read canvas state
   - Create elements
   - Modify existing elements
   - Search by pattern
   - Export to images

2. **MCP Integration**: Uses Model Context Protocol clients for tool execution
3. **Subagent Delegation**: Specialized agents for specific tasks (moodboards, mindmaps, diagrams, etc.)

---

## Context Management

| Feature | aiCore | btcp-ai-agents |
|---------|--------|----------------|
| Request Context | `AiRequestContext` with metadata | Sophisticated context managers |
| Recursive Calling | `context.recursiveCall()` | TOAD loop iteration |
| Token Budgeting | ❌ | ✅ |
| Tiered Memory | ❌ | ✅ |
| Echo-Poisoning Validation | ❌ | ✅ |

### aiCore Context

```typescript
interface AiRequestContext {
  providerId: ProviderId
  model: LanguageModel | ImageModelV2
  originalParams: any
  metadata: Record<string, any>
  startTime: number
  requestId: string
  recursiveCall: (newParams) => Promise<any>
  mcpTools?: ToolSet
}
```

### btcp-ai-agents Context

More sophisticated awareness building with:
- Canvas state awareness
- Task state tracking
- Lifecycle management
- Interruption handling

---

## Streaming Support

| Feature | aiCore | btcp-ai-agents |
|---------|--------|----------------|
| Text Streaming | ✅ `streamText()` | ✅ `streamQuery()` |
| Object Streaming | ✅ `streamObject()` | Limited |
| Stream Transforms | ✅ Plugin-based | ❌ |
| Tool Events in Stream | ✅ | ✅ |

---

## API Patterns

### aiCore - Three Patterns

**Pattern 1: Function-First (Simple)**
```typescript
import { streamText } from '@cherrystudio/ai-core'

const result = await streamText(
  'openai',
  { apiKey: 'xxx' },
  { model: 'gpt-4', messages: [...] },
  [plugin1, plugin2]
)
```

**Pattern 2: Executor Instance (Complex)**
```typescript
import { createExecutor } from '@cherrystudio/ai-core'

const executor = createExecutor('anthropic', { apiKey: 'xxx' }, [plugins])
await executor.streamText({ model: 'claude-3', messages: [...] })
```

**Pattern 3: Direct Model Usage (Advanced)**
```typescript
const model = await globalModelResolver.resolveLanguageModel('gpt-4', 'openai')
const result = await streamText({ model, messages: [...] })
```

### btcp-ai-agents - Session-Based

**V1: Query Pattern**
```typescript
import { query, prompt, runQuery, streamQuery } from '@btcp/ai-agents'

const result = await query({ message: '...', provider: 'openai' })
```

**V2: Session Pattern**
```typescript
import { createSession, resumeSession } from '@btcp/ai-agents'

const session = await createSession({ provider: 'google' })
const response = await session.send('...')
await resumeSession(session.id)
```

---

## Agent Types

### aiCore

- No predefined agent types
- Architecture "agent-ready" for future OpenAI Agents SDK integration
- Designed for single-request execution with optional recursion

### btcp-ai-agents

Predefined agent modes:
- `GENERIC_AGENT` - Base agent
- `PLANNER_AGENT` - Planning workflows
- `EXECUTOR_AGENT` - Action execution
- `ANALYZER_AGENT` - Analysis tasks
- `EXPLORER_AGENT` - Exploration/discovery

Helper functions:
- `getGenericAgent()` - Runtime agent selection
- `detectAgentMode()` - Automatic capability matching

---

## Platform Support

| Platform | aiCore | btcp-ai-agents |
|----------|--------|----------------|
| Node.js | ✅ | ✅ (`node.ts`) |
| Browser | ✅ | ✅ (`browser.ts`) |
| Server | ✅ | ✅ (`server.ts`) |
| React Native | ✅ | ❓ |

---

## Use Case Fit

### Best for aiCore

- **Multi-provider applications** needing broad LLM support
- **Desktop/Electron apps** (Cherry Studio's primary use case)
- **Plugin-driven architectures** requiring extensibility
- **Simple request/response** without complex agent loops
- **Web search integration** across multiple providers

### Best for btcp-ai-agents

- **Canvas/whiteboard applications**
- **Visual collaboration tools**
- **Complex agentic workflows** requiring iterative execution
- **Browser-first applications** using BTCP
- **Token-aware context management**
- **Specialized domain agents** (diagrams, mindmaps, etc.)

---

## Summary

| Dimension | aiCore Winner | btcp-ai-agents Winner |
|-----------|---------------|----------------------|
| Provider breadth | ✅ (19+ providers) | |
| Agentic patterns | | ✅ (TOAD loop, agent types) |
| Plugin system | ✅ (Rollup-style hooks) | |
| Context management | | ✅ (token budgeting, tiered memory) |
| Canvas/visual ops | | ✅ (domain-specific) |
| Type safety | ✅ (strong generics) | |
| Streaming transforms | ✅ | |
| Subagent delegation | | ✅ |

**Complementary Strengths**: aiCore excels at provider abstraction and plugin-driven extensibility, while btcp-ai-agents excels at structured agentic execution and domain-specific (canvas) operations. The two frameworks solve different problems and could potentially be combined - using aiCore's provider layer with btcp-ai-agents' TOAD execution pattern.
