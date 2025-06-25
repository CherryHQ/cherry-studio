# CLAUDE.md - Neucleos Platform Development Guide

This file provides comprehensive guidance to Claude Code (claude.ai/code) when working with the Neucleos platform. All development MUST follow these standards and methodologies.

## 🎯 Perfect Information (PI) Methodology

### Core Principles

1. **Complete Context Gathering**: Before any implementation, gather ALL relevant information:
   - Read related files completely using batch operations
   - Check existing patterns in the codebase
   - Verify dependencies and integration points
   - Document assumptions explicitly

2. **Atomic Operations**: Every change must be:
   - Self-contained and testable
   - Reversible with clear rollback strategy
   - Documented with rationale
   - Performance benchmarked

3. **Information Flow Standards**:
   ```typescript
   // ALWAYS include comprehensive JSDoc
   /**
    * @description Processes AI agent messages with full context
    * @param {AgentMessage} message - Structured message from agent
    * @param {AgentContext} context - Complete execution context
    * @returns {ProcessedResult} Result with telemetry data
    * @throws {AgentError} When message validation fails
    * @performance O(n) where n is message complexity
    * @security Validates all inputs against schema
    */
   ```

4. **Decision Documentation**: Every architectural decision requires:
   - ADR (Architecture Decision Record) in `docs/adr/`
   - Performance impact analysis
   - Security implications review
   - Multi-agent coordination effects

## 🏗️ Neucleos Platform Overview

Neucleos is a distributed AI agent orchestration platform with three core components:

1. **Cockpit (Electron Desktop App)**: Primary user interface and agent controller
2. **ADK (Agent Development Kit)**: Java-based agent runtime and orchestration
3. **A2A (Agent-to-Agent Protocol)**: Inter-agent communication layer

### Platform Integration Points

```typescript
// Platform service connections
const SERVICES = {
  GATEWAY: 'http://localhost:8080',      // API Gateway with auth & rate limiting
  ADK_SERVER: 'http://localhost:8081',   // Agent orchestration (Java/gRPC)
  A2A_SERVICE: 'http://localhost:8082',  // Inter-agent communication
  MCP_TOOLS: 'http://localhost:8083',    // Model Context Protocol tools
}

// Performance SLAs
const PERFORMANCE_REQUIREMENTS = {
  API_RESPONSE_P95: 200,    // 95th percentile < 200ms
  API_RESPONSE_P99: 500,    // 99th percentile < 500ms
  STARTUP_TIME: 3000,       // App ready in < 3s
  MEMORY_LIMIT: 512,        // Max 512MB per agent
  ERROR_RATE: 0.001,        // < 0.1% error rate
}
```

## 🔒 Electron Security Guidelines

### Process Isolation

```typescript
// Main process - NEVER expose sensitive operations
// ❌ INCORRECT
ipcMain.handle('execute-command', async (_, command) => {
  return exec(command) // Security vulnerability!
})

// ✅ CORRECT - Validate and whitelist
ipcMain.handle('execute-command', async (_, command) => {
  const allowedCommands = ['status', 'health', 'metrics']
  if (!allowedCommands.includes(command)) {
    throw new SecurityError('Command not allowed')
  }
  return executeWhitelistedCommand(command)
})
```

### Context Isolation Standards

1. **Preload Scripts**: Minimal API exposure
   ```typescript
   // src/preload/index.ts
   contextBridge.exposeInMainWorld('api', {
     // Only expose specific, validated methods
     sendMessage: (channel: string, data: unknown) => {
       const allowedChannels = ['agent:message', 'agent:status']
       if (allowedChannels.includes(channel)) {
         ipcRenderer.send(channel, sanitizeData(data))
       }
     }
   })
   ```

2. **Content Security Policy**:
   ```typescript
   // Strict CSP for all windows
   const CSP = [
     "default-src 'self'",
     "script-src 'self'",
     "style-src 'self' 'unsafe-inline'",
     "img-src 'self' data: https:",
     "connect-src 'self' http://localhost:* https://api.anthropic.com https://api.openai.com"
   ].join('; ')
   ```

3. **Input Validation**: All IPC messages must be validated
   ```typescript
   import { z } from 'zod'
   
   const AgentMessageSchema = z.object({
     id: z.string().uuid(),
     type: z.enum(['text', 'command', 'query']),
     content: z.string().max(10000),
     metadata: z.record(z.string(), z.unknown()).optional()
   })
   ```

## 🤖 AI Agent Collaboration Patterns

### Agent Communication Standards

```typescript
interface AgentMessage {
  id: string
  sourceAgent: string
  targetAgent: string
  protocol: 'a2a' | 'mcp' | 'direct'
  payload: {
    intent: string
    data: unknown
    context: AgentContext
  }
  telemetry: {
    timestamp: number
    traceId: string
    spanId: string
  }
}

// Agent coordination pattern
class AgentCoordinator {
  async coordinateTask(task: Task): Promise<TaskResult> {
    // 1. Task decomposition
    const subtasks = await this.decomposeTask(task)
    
    // 2. Agent selection based on capabilities
    const assignments = await this.selectAgents(subtasks)
    
    // 3. Parallel execution with monitoring
    const results = await Promise.allSettled(
      assignments.map(a => this.executeWithTelemetry(a))
    )
    
    // 4. Result aggregation and validation
    return this.aggregateResults(results)
  }
}
```

### Multi-Agent Coordination

1. **Consensus Mechanisms**:
   ```typescript
   // Implement quorum-based decision making
   async function reachConsensus(agents: Agent[], proposal: Proposal): Promise<Decision> {
     const votes = await Promise.all(
       agents.map(agent => agent.vote(proposal))
     )
     
     const quorum = Math.ceil(agents.length * 0.66) // 2/3 majority
     const approvals = votes.filter(v => v.approved).length
     
     return {
       approved: approvals >= quorum,
       votes,
       confidence: approvals / agents.length
     }
   }
   ```

2. **Resource Coordination**:
   ```typescript
   // Prevent resource conflicts between agents
   class ResourceManager {
     private locks = new Map<string, string>() // resource -> agentId
     
     async acquireResource(agentId: string, resource: string): Promise<boolean> {
       const acquired = await this.redis.set(
         `lock:${resource}`,
         agentId,
         'NX', // Only set if not exists
         'EX', 30 // 30 second TTL
       )
       return acquired === 'OK'
     }
   }
   ```

## 📊 Performance Requirements

### Metrics Collection

```typescript
// Required performance instrumentation
import { metrics } from '@opentelemetry/api-metrics'

const meter = metrics.getMeter('neucleos-cockpit', '1.0.0')

// Response time histogram
const responseTime = meter.createHistogram('http_request_duration', {
  description: 'HTTP request duration in milliseconds',
  unit: 'ms',
})

// Agent task counter
const agentTasks = meter.createCounter('agent_tasks_total', {
  description: 'Total number of agent tasks processed',
})

// Memory gauge
const memoryUsage = meter.createObservableGauge('process_memory_usage', {
  description: 'Process memory usage in MB',
})
```

### Performance Budgets

```typescript
// Enforce performance budgets
const PERFORMANCE_BUDGETS = {
  RENDER_BLOCKING_JS: 50,     // Max 50KB of render-blocking JS
  TOTAL_JS_SIZE: 500,         // Max 500KB total JS (gzipped)
  FIRST_PAINT: 1000,          // First paint < 1s
  TIME_TO_INTERACTIVE: 3000,  // TTI < 3s
  MEMORY_LEAK_THRESHOLD: 10,  // Max 10MB/hour growth
}

// Performance monitoring middleware
export function performanceMiddleware(req: Request, res: Response, next: Next) {
  const start = performance.now()
  
  res.on('finish', () => {
    const duration = performance.now() - start
    
    // Record metrics
    responseTime.record(duration, {
      method: req.method,
      route: req.route.path,
      status: res.statusCode,
    })
    
    // Alert on SLA violations
    if (duration > PERFORMANCE_REQUIREMENTS.API_RESPONSE_P95) {
      logger.warn('SLA violation', { duration, route: req.route.path })
    }
  })
  
  next()
}
```

## 🧪 Testing Standards

### Test Coverage Requirements

```yaml
coverage:
  statements: 80    # Minimum 80% statement coverage
  branches: 75      # Minimum 75% branch coverage
  functions: 80     # Minimum 80% function coverage
  lines: 80         # Minimum 80% line coverage
```

### Test Categories

1. **Unit Tests** (Fast, isolated):
   ```typescript
   describe('AgentCoordinator', () => {
     it('should coordinate tasks with proper telemetry', async () => {
       const coordinator = new AgentCoordinator()
       const mockTelemetry = jest.spyOn(telemetry, 'startSpan')
       
       await coordinator.coordinateTask(testTask)
       
       expect(mockTelemetry).toHaveBeenCalledWith('agent.coordinate', {
         attributes: expect.objectContaining({
           'agent.task.id': testTask.id,
           'agent.task.type': testTask.type,
         })
       })
     })
   })
   ```

2. **Integration Tests** (Cross-process):
   ```typescript
   test('IPC communication between main and renderer', async () => {
     const app = await startTestApp()
     const window = await app.firstWindow()
     
     // Test secure IPC
     const result = await window.evaluate(() => 
       window.api.sendMessage('agent:status', { agentId: 'test-123' })
     )
     
     expect(result).toMatchObject({
       status: 'active',
       agentId: 'test-123',
     })
   })
   ```

3. **Performance Tests**:
   ```typescript
   test('agent coordination meets performance SLA', async () => {
     const tasks = generateTestTasks(100)
     const start = performance.now()
     
     await Promise.all(
       tasks.map(task => coordinator.coordinateTask(task))
     )
     
     const duration = performance.now() - start
     const avgTime = duration / tasks.length
     
     expect(avgTime).toBeLessThan(PERFORMANCE_REQUIREMENTS.API_RESPONSE_P95)
   })
   ```

## 📝 Documentation Standards

### Code Documentation

1. **File Headers**:
   ```typescript
   /**
    * @file AgentCoordinator.ts
    * @description Manages multi-agent task coordination with consensus mechanisms
    * @module neucleos/agent-coordination
    * @performance Critical path - requires sub-200ms response times
    * @security Validates all agent messages against schema
    */
   ```

2. **Function Documentation**:
   ```typescript
   /**
    * Coordinates task execution across multiple AI agents
    * 
    * @param task - The task to be coordinated
    * @param options - Coordination options
    * @param options.timeout - Maximum execution time (default: 30s)
    * @param options.retries - Number of retry attempts (default: 3)
    * @param options.consensus - Required consensus level (default: 0.66)
    * 
    * @returns Promise resolving to aggregated task results
    * 
    * @example
    * const result = await coordinator.coordinateTask({
    *   id: 'task-123',
    *   type: 'research',
    *   query: 'Latest AI developments'
    * }, { timeout: 60000 })
    * 
    * @throws {TaskTimeoutError} When task exceeds timeout
    * @throws {ConsensusError} When agents cannot reach consensus
    * 
    * @performance O(n*m) where n=agents, m=subtasks
    * @sentry-transaction agent-coordination
    */
   ```

### API Documentation

All public APIs must include OpenAPI specifications:

```yaml
paths:
  /api/agents/{agentId}/tasks:
    post:
      summary: Create agent task
      operationId: createAgentTask
      x-performance-sla: 200ms
      x-rate-limit: 100/minute
      parameters:
        - name: agentId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/TaskRequest'
      responses:
        '201':
          description: Task created successfully
```

## 🚨 Sentry Instrumentation

### Error Tracking

```typescript
import * as Sentry from '@sentry/electron'

// Initialize Sentry in main process
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Sentry.Integrations.Electron(),
  ],
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  beforeSend(event, hint) {
    // Scrub sensitive data
    if (event.request?.data) {
      event.request.data = scrubSensitiveData(event.request.data)
    }
    return event
  },
})

// Instrument critical operations
export async function criticalOperation(data: any) {
  const transaction = Sentry.startTransaction({
    op: 'agent.critical',
    name: 'Critical Agent Operation',
  })
  
  try {
    const span = transaction.startChild({
      op: 'validation',
      description: 'Validate input data',
    })
    
    await validateData(data)
    span.finish()
    
    // ... operation logic
    
    transaction.setStatus('ok')
  } catch (error) {
    transaction.setStatus('internal_error')
    Sentry.captureException(error, {
      tags: {
        component: 'agent-coordinator',
        severity: 'high',
      },
      extra: {
        input: sanitizeForLogging(data),
      },
    })
    throw error
  } finally {
    transaction.finish()
  }
}
```

### Performance Monitoring

```typescript
// Monitor render performance
Sentry.metrics.measure(
  'electron.renderer.paint',
  () => {
    // Render operation
  },
  { tags: { window: 'main' } }
)

// Track custom metrics
Sentry.metrics.increment('agent.tasks.completed', 1, {
  tags: { agent_type: 'researcher' }
})

Sentry.metrics.gauge('agent.memory.usage', process.memoryUsage().heapUsed, {
  unit: 'byte',
})
```

## 🔧 Development Commands

### Running the Application

- `yarn dev`: Start development server with hot reload (port 5173)
- `yarn dev:safe`: Check port availability before starting (recommended)
- `yarn debug`: Start with debugging enabled (use `--inspect` and remote debugging on port 9222)
- `yarn dev:perf`: Start with performance profiling enabled

### Building

- `yarn build`: Build for current platform (runs typecheck first)
- `yarn build:check`: Full build validation (typecheck + i18n + tests + security audit)
- `yarn build:win`: Build for Windows (both x64 and arm64)
- `yarn build:mac`: Build for macOS (both x64 and arm64)
- `yarn build:linux`: Build for Linux platforms
- `yarn build:analyze`: Build with bundle analysis

### Testing

- `yarn test`: Run all tests (main + renderer + integration)
- `yarn test:main`: Test main process only
- `yarn test:renderer`: Test renderer process only
- `yarn test:integration`: Run integration tests
- `yarn test:performance`: Run performance test suite
- `yarn test:security`: Run security test suite
- `yarn test:coverage`: Generate test coverage report
- `yarn test:e2e`: Run Playwright end-to-end tests
- `yarn test:watch`: Run tests in watch mode for TDD
- `yarn test:ui`: Open Vitest UI for interactive testing

### Code Quality

- `yarn lint`: Run ESLint checks and auto-fix
- `yarn lint:security`: Run security-focused linting rules
- `yarn format`: Format code with Prettier
- `yarn typecheck`: Run TypeScript type checking (both node and web)
- `yarn audit`: Run security audit on dependencies
- `yarn analyze:renderer`: Analyze renderer bundle size
- `yarn analyze:main`: Analyze main process bundle size
- `yarn metrics`: Generate code metrics report

### Platform Integration

- `yarn platform:status`: Check all platform services status
- `yarn platform:logs`: Aggregate logs from all services
- `yarn platform:test`: Run full platform integration tests
- `yarn agent:spawn <type>`: Spawn a test agent
- `yarn mcp:validate`: Validate MCP tool configurations

## 🏗️ Architecture Patterns

### Multi-Process Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Cockpit Electron App                      │
├─────────────────┬─────────────────┬─────────────────────────────┤
│   Main Process  │ Renderer Process│    Preload Scripts          │
│   - IPC Handler │ - React App     │    - Context Bridge         │
│   - Window Mgmt │ - Redux Store   │    - Security Layer         │
│   - MCP Servers │ - AI Core       │    - API Exposure           │
└─────────────────┴─────────────────┴─────────────────────────────┘
           │                │                      │
           ▼                ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Platform Services Layer                        │
├──────────────┬──────────────┬──────────────┬──────────────────┤
│  API Gateway │  ADK Server  │ A2A Service  │   MCP Tools      │
│  Port: 8080  │  Port: 8081  │ Port: 8082   │   Port: 8083     │
└──────────────┴──────────────┴──────────────┴──────────────────┘
```

### State Management Pattern

```typescript
// Unified state management with cross-process sync
interface NucleosState {
  agents: AgentState
  tasks: TaskState
  telemetry: TelemetryState
  ui: UIState
}

// Redux slice with IPC sync
const agentSlice = createSlice({
  name: 'agents',
  initialState,
  reducers: {
    agentStatusUpdated: (state, action) => {
      state.agents[action.payload.id] = action.payload.status
      
      // Sync to main process
      window.api.updateAgentStatus(action.payload)
    }
  }
})
```

## 🚀 Performance Optimization

### Bundle Optimization

```javascript
// vite.config.ts optimizations
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ai': ['openai', '@anthropic-ai/sdk', '@google/generative-ai'],
          'vendor-utils': ['lodash', 'date-fns', 'zod'],
        }
      }
    },
    chunkSizeWarningLimit: 500, // Warn on chunks > 500KB
  },
  optimizeDeps: {
    include: ['react', 'react-dom'], // Pre-bundle heavy deps
  }
})
```

### Memory Management

```typescript
// Implement memory-aware caching
class MemoryAwareCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private memoryLimit = 100 * 1024 * 1024 // 100MB
  
  async set(key: string, value: T): Promise<void> {
    const size = this.estimateSize(value)
    
    // Evict if necessary
    while (this.currentSize + size > this.memoryLimit) {
      this.evictLRU()
    }
    
    this.cache.set(key, {
      value,
      size,
      lastAccessed: Date.now()
    })
  }
}
```

## 🔄 Development Workflow

### Feature Development Checklist

- [ ] Create feature branch from `main`
- [ ] Write ADR for significant changes
- [ ] Implement with TDD approach
- [ ] Add comprehensive JSDoc
- [ ] Include telemetry instrumentation
- [ ] Add security validation
- [ ] Write integration tests
- [ ] Run performance benchmarks
- [ ] Update documentation
- [ ] Create PR with detailed description

### Code Review Standards

1. **Security**: All IPC channels validated
2. **Performance**: Meets SLA requirements
3. **Testing**: 80%+ coverage with edge cases
4. **Documentation**: Complete JSDoc and examples
5. **Telemetry**: Proper Sentry instrumentation
6. **Architecture**: Follows platform patterns

## 📚 Additional Resources

- `docs/architecture/`: System architecture documentation
- `docs/adr/`: Architecture Decision Records
- `docs/api/`: API specifications
- `docs/security/`: Security guidelines and threat models
- `CONTRIBUTING.md`: Contribution guidelines
- `SECURITY.md`: Security policies and reporting

## ⚠️ Critical Reminders

1. **NEVER** expose sensitive operations through IPC without validation
2. **ALWAYS** use the tab system for navigation (avoid direct `navigate()`)
3. **ALWAYS** validate and sanitize all external inputs
4. **ALWAYS** include telemetry for critical operations
5. **NEVER** store credentials in code or logs
6. **ALWAYS** use type-safe APIs with Zod validation
7. **ALWAYS** test error paths and edge cases
8. **NEVER** bypass security controls for convenience

## 🎯 Quick Reference

```typescript
// Common imports for Neucleos development
import { z } from 'zod'
import * as Sentry from '@sentry/electron'
import { metrics } from '@opentelemetry/api-metrics'
import { logger } from '@main/services/LoggerService'
import { validateSchema } from '@shared/validation'
import { AgentMessage, AgentContext } from '@shared/types'

// Performance monitoring wrapper
export function withPerformanceMonitoring<T extends (...args: any[]) => any>(
  fn: T,
  operationName: string
): T {
  return (async (...args: Parameters<T>) => {
    const span = Sentry.startSpan({ name: operationName })
    try {
      const result = await fn(...args)
      span.setStatus({ code: 1 }) // OK
      return result
    } catch (error) {
      span.setStatus({ code: 2 }) // ERROR
      throw error
    } finally {
      span.end()
    }
  }) as T
}
```

Remember: Quality over speed. A well-architected solution following these guidelines will save time in the long run.

## Perfect Information (PI) Standards

The project enforces Perfect Information standards to ensure code quality:

- **Setup**: Run `./scripts/setup-pi.sh` to configure PI checking locally
- **Check**: Run `node scripts/pi-checker.js` before committing
- **Auto-fix**: Run `node scripts/pi-checker.js --fix` to fix common issues
- **Documentation**: See `.github/pi-standards.md` for full standards
- **CI/CD**: GitHub Actions automatically enforce PI standards on all PRs

Key requirements:
- All exported functions must have JSDoc comments
- Minimum 80% test coverage
- No console.log statements in production code
- No hardcoded secrets or API keys
- Proper error handling for all async operations
- Conventional commit messages

## Additional Resources

- `CURRENT_STATE_2025-01-27.md`: Detailed status of recent fixes and changes
- `docs/`: Architecture and development documentation
- `README.md`: Public-facing project information and setup instructions
- `.github/pi-standards.md`: Complete Perfect Information standards documentation
- `.claude/commands/verify-pi.md`: Claude command for PI verification