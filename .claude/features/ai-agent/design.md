# AI Agent Technical Design

**Feature**: AI Agent System for Cherry Studio
**Version**: 1.0
**Date**: July 29, 2025

## Technical Overview

### Architecture Approach
The AI Agent feature extends Cherry Studio's existing Electron architecture by introducing a **hybrid execution model** that combines TypeScript-based UI management with Python-based agent runtime. This approach leverages the existing ApiServer infrastructure while enabling flexible agent implementations in multiple languages.

### Technology Stack Justification
- **Frontend**: React + TypeScript + Redux Toolkit (existing stack for consistency)
- **Backend**: Electron Main Process + TypeScript (UI and process management)
- **Agent Runtime**: Python child processes (flexibility for AI/ML libraries)
- **Database**: LibSQL (existing, as specified in requirements)
- **Communication**: IPC (Inter-Process Communication) between main process and Python child processes

### Key Design Decisions
1. **Process Isolation**: Agents run in separate Python processes for security and stability
2. **IPC Communication**: Use Node.js child_process for direct communication with Python agents
3. **UI Focus**: Electron app handles UI, data persistence, and process management only
4. **Agent Abstraction**: Python processes handle all agent logic, tools, and LLM communication

## System Architecture

### High-Level Component Diagram
```
┌─────────────────────────────────────────────────────────────────┐
│                    Cherry Studio Electron App                   │
├─────────────────────────────────────────────────────────────────┤
│  Renderer Process (React + TypeScript)                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   Agent Hub     │  │ Agent Config    │  │ Execution View  │ │
│  │     Page        │  │    Editor       │  │     Panel       │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  Main Process (TypeScript)                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  Agent Service  │  │ Process Manager │  │   ApiServer     │ │
│  │   (Database)    │  │  (Child Procs)  │  │ (OpenAI API)    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   MCP Servers   │  │  File System    │  │   Web Search    │ │
│  │   (Tools)       │  │    Service      │  │    Service      │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  Child Processes (Python)                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Agent Runtime 1 │  │ Agent Runtime 2 │  │ Agent Runtime N │ │
│  │   (ReAct Loop)  │  │   (ReAct Loop)  │  │   (ReAct Loop)  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow and Component Interactions
1. **Agent Creation**: UI → Main Process → Database (persist agent config)
2. **Agent Execution**: UI → Main Process → Python Child Process (via IPC)
3. **Real-time Updates**: Python Process → Main Process (via IPC stdout/stderr) → UI (live log updates)
4. **Process Management**: Main Process spawns, monitors, and terminates Python child processes

### Integration Points and Dependencies
- **Database Integration**: Agent configs and execution logs stored in LibSQL
- **Process Management**: Node.js child_process module for Python process lifecycle
- **IPC Communication**: JSON messages over stdin/stdout between processes

## Data Design

### Database Schema and Relationships

#### Agents Table
```sql
CREATE TABLE agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    avatar TEXT,
    instructions TEXT NOT NULL,
    model TEXT NOT NULL,
    tools JSON NOT NULL DEFAULT '[]',
    knowledges JSON NOT NULL DEFAULT '[]',
    configuration JSON NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### Sessions Table
```sql
CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_ids JSON NOT NULL,
    user_prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    accessible_paths JSON NOT NULL DEFAULT '[]',
    process_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### Session Logs Table
```sql
CREATE TABLE session_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    parent_id INTEGER,
    role TEXT NOT NULL,
    type TEXT NOT NULL,
    content JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES session_logs(id) ON DELETE SET NULL
);
```

### Data Validation and Constraints
- **Agent Names**: Unique, 1-100 characters, alphanumeric and spaces only
- **System Prompts**: 10-10,000 characters, required
- **Tools Array**: Validate against available tool registry
- **Knowledge IDs**: Validate against existing knowledge bases
- **Session Status**: Enum values: 'pending', 'running', 'completed', 'failed', 'stopped'

### Migration and Versioning Strategy
- **Schema Migrations**: Use Electron-compatible SQLite migration system
- **Backward Compatibility**: Maintain compatibility with existing database structure
- **Data Export/Import**: JSON format for agent configurations
- **Version Tracking**: Add schema_version table for future migrations

## IPC Communication Design

### Streaming Communication Protocol
The Electron main process communicates with Python child processes using **streaming JSON messages** over stdin/stdout for real-time updates:

#### Message Format
```typescript
interface IPCMessage {
  type: 'start' | 'stop' | 'log' | 'status' | 'result' | 'error' | 'stream'
  sessionId: string
  data: any
  timestamp: number
}
```

#### Main Process → Python Process (stdin)
```typescript
// Start execution
{
  type: 'start',
  sessionId: 'session_123',
  data: {
    agentConfig: Agent,
    userPrompt: string,
    accessiblePaths: string[]
  }
}

// Stop execution
{
  type: 'stop',
  sessionId: 'session_123'
}
```

#### Python Process → Main Process (stdout - streaming)
```typescript
// Streaming log entry (real-time)
{
  type: 'stream',
  sessionId: 'session_123',
  data: {
    role: 'agent',
    type: 'thought' | 'action' | 'observation' | 'final_answer',
    content: string,    // Partial content for streaming
    isComplete: boolean // true when message is complete
  }
}

// Complete log entry (for persistence)
{
  type: 'log',
  sessionId: 'session_123',
  data: {
    role: 'agent',
    type: 'thought' | 'action' | 'observation' | 'final_answer',
    content: any,       // Complete content
    metadata?: any      // Additional data like tool parameters
  }
}

// Status update
{
  type: 'status',
  sessionId: 'session_123',
  data: { status: 'running' | 'completed' | 'failed' | 'stopped' }
}
```

### Streaming Implementation
```typescript
// Main process handles streaming output
pythonProcess.stdout.on('data', (chunk: Buffer) => {
  const lines = chunk.toString().split('\n').filter(line => line.trim())
  
  for (const line of lines) {
    try {
      const message: IPCMessage = JSON.parse(line)
      
      if (message.type === 'stream') {
        // Forward streaming content to UI immediately
        this.sendToRenderer('agent-stream-update', {
          sessionId: message.sessionId,
          content: message.data.content,
          type: message.data.type,
          isComplete: message.data.isComplete
        })
      } else if (message.type === 'log') {
        // Persist complete log entry to database
        await this.persistLogEntry(message.sessionId, message.data)
      }
    } catch (error) {
      console.error('Failed to parse IPC message:', error)
    }
  }
})
```

## Security Considerations

### Process Management Security
- **Process Isolation**: Each agent runs in separate Python child process
- **Resource Limits**: CPU, memory, and execution time limits per agent process
- **Process Cleanup**: Proper cleanup of child processes on app shutdown or crashes

### Data Security
- **Database Encryption**: Sensitive agent instructions encrypted at rest using existing encryption
- **Input Validation**: Validate all agent configuration inputs before saving to database
- **IPC Message Validation**: Validate all messages received from Python processes

### UI Security
- **Input Sanitization**: Sanitize user inputs in agent configuration forms
- **XSS Prevention**: Properly escape content when displaying execution logs in UI
- **File Path Validation**: Validate accessible_paths before passing to agents

## Performance & Scalability

### Performance Targets and Bottlenecks
- **Agent List Loading**: < 1 second for up to 100 agents
- **Execution Start Time**: < 3 seconds from user click to agent start
- **Log Updates**: < 500ms latency for real-time log streaming
- **Concurrent Agents**: Support up to 5 simultaneous agent executions

### Caching Strategies
- **Agent Configurations**: Redis-style in-memory cache in main process
- **MCP Tool Results**: Cache tool responses for 5 minutes to reduce API calls
- **Model Responses**: Optional caching for repeated queries within session
- **Database Queries**: Query result caching for frequently accessed data

### Database Optimization
- **Indexing Strategy**: Index on agent.name, session.status, session_logs.session_id
- **Query Optimization**: Use prepared statements and connection pooling
- **Log Archival**: Archive old session logs after 30 days to maintain performance
- **Pagination**: Implement cursor-based pagination for large result sets

### Scaling Considerations
- **Process Pool**: Reuse Python processes for multiple agent executions
- **Resource Monitoring**: Monitor CPU/memory usage per agent process
- **Graceful Degradation**: Fallback to reduced functionality under high load
- **Horizontal Scaling**: Future support for distributed agent execution

## Implementation Approach

### Development Phases and Priorities

#### Phase 1: Core Infrastructure (Week 1-2)
- Database schema implementation and migrations
- Agent service layer in main process
- Basic UI components (Agent Hub, Agent List)
- Python process management system

#### Phase 2: Agent Runtime (Week 3-4)
- Python agent runtime with ReAct loop implementation
- ApiServer integration for LLM communication
- Basic tool integration (file system, web search)
- Execution logging and status management

#### Phase 3: UI and UX (Week 5-6)
- Complete Agent Configuration UI
- Execution panel with real-time logs
- Agent templates implementation
- Error handling and user feedback

#### Phase 4: Security and Polish (Week 7-8)
- Workspace sandbox implementation
- Security audit and penetration testing
- Performance optimization
- Comprehensive testing and bug fixes

### Testing Strategy Alignment
- **Unit Tests**: Jest/Vitest for TypeScript components, pytest for Python agents
- **Integration Tests**: Test agent-to-ApiServer communication
- **E2E Tests**: Playwright tests for complete user workflows
- **Performance Tests**: Load testing for concurrent agent executions
- **Security Tests**: Penetration testing for sandbox and API security

### Deployment and Rollout Plan
- **Feature Flag**: Implement behind feature toggle for gradual rollout
- **Alpha Release**: Internal testing with limited agent templates
- **Beta Release**: External testing with full feature set
- **Production Release**: Full release with monitoring and support

## Process Management

### Python Child Process Lifecycle with Streaming
```typescript
class AgentProcessManager {
  private processes: Map<string, ChildProcess> = new Map()
  private streamBuffers: Map<string, string> = new Map()
  
  async startAgent(sessionId: string, agentConfig: Agent, userPrompt: string): Promise<void> {
    const pythonProcess = spawn('python', ['-m', 'agent_runtime'], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    
    this.processes.set(sessionId, pythonProcess)
    this.streamBuffers.set(sessionId, '')
    
    // Send initial configuration
    this.sendMessage(pythonProcess, {
      type: 'start',
      sessionId,
      data: { agentConfig, userPrompt, accessiblePaths: [] }
    })
    
    // Handle streaming output
    pythonProcess.stdout.on('data', (chunk: Buffer) => {
      this.handleStreamingData(sessionId, chunk)
    })
    
    // Handle process exit
    pythonProcess.on('exit', (code, signal) => {
      this.handleProcessExit(sessionId, code, signal)
    })
  }
  
  private handleStreamingData(sessionId: string, chunk: Buffer): void {
    const buffer = this.streamBuffers.get(sessionId) || ''
    const newData = buffer + chunk.toString()
    const lines = newData.split('\n')
    
    // Keep incomplete line in buffer
    this.streamBuffers.set(sessionId, lines.pop() || '')
    
    // Process complete lines
    for (const line of lines) {
      if (line.trim()) {
        try {
          const message: IPCMessage = JSON.parse(line)
          this.handleIPCMessage(sessionId, message)
        } catch (error) {
          console.error('Failed to parse streaming message:', error)
        }
      }
    }
  }
  
  private async handleIPCMessage(sessionId: string, message: IPCMessage): Promise<void> {
    switch (message.type) {
      case 'stream':
        // Forward streaming content to renderer immediately
        this.sendToRenderer('agent-stream-update', {
          sessionId,
          ...message.data
        })
        break
      
      case 'log':
        // Persist complete log entry
        await this.persistLogEntry(sessionId, message.data)
        break
        
      case 'status':
        // Update session status
        await this.updateSessionStatus(sessionId, message.data.status)
        break
    }
  }
  
  stopAgent(sessionId: string): void {
    const process = this.processes.get(sessionId)
    if (process) {
      process.kill('SIGTERM')
      this.processes.delete(sessionId)
      this.streamBuffers.delete(sessionId)
    }
  }
}
```

### Streaming Error Handling
- **Buffer Management**: Handle partial JSON messages across buffer boundaries
- **Process Crashes**: Monitor child process exit codes and clean up stream buffers
- **Communication Errors**: Gracefully handle malformed streaming messages
- **Memory Management**: Clean up stream buffers when processes terminate

## Quality Gates

### Design Validation Checklist
- [x] Addresses every EARS requirement from requirements.md
- [x] Includes comprehensive security considerations
- [x] Defines clear component boundaries between TypeScript and Python
- [x] Specifies data models and relationships with proper constraints
- [x] Covers error handling and edge cases throughout the system
- [x] Includes performance considerations and scaling strategies
- [x] Is implementable with chosen tech stack (Electron + Python + existing ApiServer)
- [x] Maintains consistency with existing Cherry Studio architecture
- [x] Provides clear interfaces between all components
- [x] Includes comprehensive testing strategy

### Risk Assessment and Mitigation
- **Process Management Risk**: Mitigation through robust process monitoring and restart mechanisms
- **Security Risk**: Mitigation through workspace sandbox and input validation
- **Performance Risk**: Mitigation through resource limits and monitoring
- **Integration Risk**: Mitigation through comprehensive API testing and error handling

This technical design provides a comprehensive blueprint for implementing the AI Agent feature while leveraging Cherry Studio's existing infrastructure and maintaining architectural consistency.