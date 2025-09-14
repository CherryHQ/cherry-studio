# Agent API UI Integration Guide

## Overview

This document provides comprehensive guidance for UI components to integrate with the new Agent API system. The agents data is now stored in the database and accessed through API endpoints instead of Redux state management.

## Key Changes from Previous Implementation

### Data Storage
- **Before**: Agent data stored in Redux store
- **After**: Agent data stored in SQLite database, accessed via REST API

### State Management
- **Before**: Redux actions and selectors for agent operations
- **After**: Direct API calls using fetch/axios, no Redux dependency

### Data Flow
- **Before**: Component → Redux Action → State Update → Component Re-render
- **After**: Component → API Call → UI Update → Database

## API Endpoints Overview

### Base Configuration
- **Base URL**: `http://localhost:23333/v1`
- **Authentication**: Bearer token (API key format: `cs-sk-{uuid}`)
- **Content-Type**: `application/json`

### Agent Management (`/agents`)

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| POST | `/agents` | Create new agent | `CreateAgentRequest` | `AgentEntity` |
| GET | `/agents` | List agents (paginated) | Query params | `{ data: AgentEntity[], total: number }` |
| GET | `/agents/{id}` | Get specific agent | - | `AgentEntity` |
| PUT | `/agents/{id}` | Update agent | `UpdateAgentRequest` | `AgentEntity` |
| DELETE | `/agents/{id}` | Delete agent | - | `204 No Content` |

### Session Management (`/agents/{agentId}/sessions`)

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| POST | `/agents/{agentId}/sessions` | Create session | `CreateSessionRequest` | `AgentSessionEntity` |
| GET | `/agents/{agentId}/sessions` | List agent sessions | Query params | `{ data: AgentSessionEntity[], total: number }` |
| GET | `/agents/{agentId}/sessions/{id}` | Get specific session | - | `AgentSessionEntity` |
| PUT | `/agents/{agentId}/sessions/{id}` | Update session | `UpdateSessionRequest` | `AgentSessionEntity` |
| PATCH | `/agents/{agentId}/sessions/{id}/status` | Update session status | `{ status: SessionStatus }` | `AgentSessionEntity` |
| DELETE | `/agents/{agentId}/sessions/{id}` | Delete session | - | `204 No Content` |

### Message Streaming (`/agents/{agentId}/sessions/{sessionId}/messages`)

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| POST | `/agents/{agentId}/sessions/{sessionId}/messages` | Send message to agent | `CreateMessageRequest` | **Stream Response** |
| GET | `/agents/{agentId}/sessions/{sessionId}/messages` | List session messages | Query params | `{ data: SessionMessageEntity[], total: number }` |

## Data Types & Schemas

### AgentEntity
```typescript
interface AgentEntity {
  id: string
  type: AgentType
  name: string
  description?: string
  avatar?: string
  instructions?: string

  // Core configuration
  model: string // Required - main model ID
  plan_model?: string
  small_model?: string
  built_in_tools?: string[]
  mcps?: string[]
  knowledges?: string[]
  configuration?: Record<string, any>
  accessible_paths?: string[]
  permission_mode?: PermissionMode
  max_steps?: number

  // Timestamps
  created_at: string
  updated_at: string
}
```

### AgentSessionEntity
```typescript
interface AgentSessionEntity {
  id: string
  name?: string
  main_agent_id: string
  sub_agent_ids?: string[]
  user_goal?: string
  status: SessionStatus
  external_session_id?: string

  // Configuration overrides (inherits from agent if not specified)
  model?: string
  plan_model?: string
  small_model?: string
  built_in_tools?: string[]
  mcps?: string[]
  knowledges?: string[]
  configuration?: Record<string, any>
  accessible_paths?: string[]
  permission_mode?: PermissionMode
  max_steps?: number

  // Timestamps
  created_at: string
  updated_at: string
}
```

### SessionMessageEntity
```typescript
interface SessionMessageEntity {
  id: number
  session_id: string
  parent_id?: number
  role: SessionMessageRole // 'user' | 'agent' | 'system' | 'tool'
  type: SessionMessageType
  content: Record<string, any>
  metadata?: Record<string, any>
  created_at: string
  updated_at: string
}
```

## Creating Agents

### Minimal Agent Creation
For early stage implementation, only use these essential fields:

```typescript
const createAgentRequest = {
  name: string,           // Required
  model: string,          // Required
  instructions?: string,  // System prompt
  built_in_tools?: string[],
  mcps?: string[],
  knowledges?: string[]
}
```

### Example: Create Agent
```typescript
async function createAgent(agentData: CreateAgentRequest): Promise<AgentEntity> {
  const response = await fetch('/v1/agents', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(agentData)
  })

  if (!response.ok) {
    throw new Error(`Agent creation failed: ${response.statusText}`)
  }

  return await response.json()
}
```

### Example: List Agents
```typescript
async function listAgents(limit = 20, offset = 0): Promise<{data: AgentEntity[], total: number}> {
  const response = await fetch(`/v1/agents?limit=${limit}&offset=${offset}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  })

  return await response.json()
}
```

## Managing Agent Sessions

### Session Creation
```typescript
async function createSession(agentId: string, sessionData: CreateSessionRequest): Promise<AgentSessionEntity> {
  const response = await fetch(`/v1/agents/${agentId}/sessions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      user_goal: sessionData.user_goal, // User's goal as input message
      model: sessionData.model,         // Override agent's model if needed
      // tools and mcps can be overridden per session
    })
  })

  return await response.json()
}
```

### Session Status Management
Sessions have five possible statuses:
- `idle`: Ready to process messages
- `running`: Currently processing
- `completed`: Task finished successfully
- `failed`: Encountered an error
- `stopped`: Manually stopped by user

```typescript
async function updateSessionStatus(agentId: string, sessionId: string, status: SessionStatus): Promise<AgentSessionEntity> {
  const response = await fetch(`/v1/agents/${agentId}/sessions/${sessionId}/status`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status })
  })

  return await response.json()
}
```

## Message Streaming Integration

### Sending Messages to Agents
The core interaction point is the message endpoint that accepts user messages and returns streamed responses:

```typescript
async function sendMessageToAgent(
  agentId: string,
  sessionId: string,
  message: CreateMessageRequest
): Promise<ReadableStream> {

  const response = await fetch(`/v1/agents/${agentId}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      role: 'user',
      type: 'message',
      content: {
        text: message.text,
        // Include any additional context
      }
    })
  })

  return response.body // Returns AI SDK streamText compatible stream
}
```

### Processing Streamed Responses
The response follows AI SDK's `streamText` format:

```typescript
async function handleAgentResponse(stream: ReadableStream) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) break

      const chunk = decoder.decode(value)
      const lines = chunk.split('\n')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)

          if (data === '[DONE]') {
            return // Stream completed
          }

          try {
            const parsed = JSON.parse(data)

            // Handle different stream events
            switch (parsed.type) {
              case 'text-delta':
                updateUI(parsed.textDelta)
                break
              case 'tool-call':
                handleToolCall(parsed.toolCall)
                break
              case 'tool-result':
                handleToolResult(parsed.toolResult)
                break
              case 'finish':
                handleFinish(parsed.finishReason)
                break
            }
          } catch (parseError) {
            console.error('Failed to parse stream data:', parseError)
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
```

## UI Component Integration Patterns

### Agent List Component
```typescript
function AgentList() {
  const [agents, setAgents] = useState<AgentEntity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadAgents() {
      try {
        const result = await listAgents()
        setAgents(result.data)
      } catch (error) {
        console.error('Failed to load agents:', error)
      } finally {
        setLoading(false)
      }
    }

    loadAgents()
  }, [])

  const handleDeleteAgent = async (agentId: string) => {
    try {
      await fetch(`/v1/agents/${agentId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${apiKey}` }
      })

      setAgents(agents.filter(agent => agent.id !== agentId))
    } catch (error) {
      console.error('Failed to delete agent:', error)
    }
  }

  if (loading) return <div>Loading...</div>

  return (
    <div>
      {agents.map(agent => (
        <AgentItem
          key={agent.id}
          agent={agent}
          onDelete={() => handleDeleteAgent(agent.id)}
        />
      ))}
    </div>
  )
}
```

### Agent Chat Component
```typescript
function AgentChat({ agentId }: { agentId: string }) {
  const [session, setSession] = useState<AgentSessionEntity | null>(null)
  const [messages, setMessages] = useState<SessionMessageEntity[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  // Create session on component mount
  useEffect(() => {
    async function initSession() {
      try {
        const newSession = await createSession(agentId, {
          user_goal: "General conversation"
        })
        setSession(newSession)

        // Load existing messages
        const messagesResult = await fetch(`/v1/agents/${agentId}/sessions/${newSession.id}/messages`, {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        }).then(r => r.json())

        setMessages(messagesResult.data)
      } catch (error) {
        console.error('Failed to initialize session:', error)
      }
    }

    initSession()
  }, [agentId])

  const sendMessage = async () => {
    if (!session || !inputMessage.trim() || isStreaming) return

    setIsStreaming(true)

    try {
      // Add user message to UI
      const userMessage = {
        role: 'user' as const,
        content: { text: inputMessage },
        created_at: new Date().toISOString()
      }
      setMessages(prev => [...prev, userMessage as any])
      setInputMessage('')

      // Send to agent and handle streaming response
      const stream = await sendMessageToAgent(agentId, session.id, {
        text: inputMessage
      })

      let agentResponse = ''
      await handleAgentResponse(stream, (delta: string) => {
        agentResponse += delta
        // Update UI with streaming text
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role === 'agent') {
            return [...prev.slice(0, -1), { ...last, content: { text: agentResponse } }]
          } else {
            return [...prev, {
              role: 'agent',
              content: { text: agentResponse },
              created_at: new Date().toISOString()
            } as any]
          }
        })
      })

    } catch (error) {
      console.error('Failed to send message:', error)
    } finally {
      setIsStreaming(false)
    }
  }

  return (
    <div className="agent-chat">
      <div className="messages">
        {messages.map((message, index) => (
          <div key={index} className={`message ${message.role}`}>
            <div className="content">{message.content.text}</div>
          </div>
        ))}
      </div>

      <div className="input-area">
        <input
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          disabled={isStreaming}
          placeholder="Type your message..."
        />
        <button onClick={sendMessage} disabled={isStreaming || !inputMessage.trim()}>
          {isStreaming ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  )
}
```

## Error Handling

### API Error Response Format
```typescript
interface ApiError {
  error: {
    message: string
    type: 'validation_error' | 'not_found' | 'internal_error' | 'authentication_error'
    code?: string
    details?: any[]
  }
}
```

### Error Handling Pattern
```typescript
async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    })

    if (!response.ok) {
      const error: ApiError = await response.json()
      throw new Error(`${error.error.type}: ${error.error.message}`)
    }

    return await response.json()
  } catch (error) {
    console.error('API request failed:', error)
    throw error
  }
}
```

## Best Practices

### 1. Agent Configuration
- **Minimal Setup**: Start with just `name`, `model`, and `instructions`
- **Gradual Enhancement**: Add `tools`, `mcps`, and `knowledges` as needed
- **Configuration Inheritance**: Sessions inherit agent settings but can override them

### 2. Session Management
- **Single Goal Per Session**: Each session should have one clear `user_goal`
- **Status Tracking**: Always update session status appropriately
- **Resource Cleanup**: Delete completed/failed sessions to manage storage

### 3. Message Streaming
- **Progressive Enhancement**: Show streaming text immediately for better UX
- **Error Recovery**: Handle stream interruptions gracefully
- **Tool Visualization**: Display tool calls and results appropriately

### 4. Performance Considerations
- **Pagination**: Always use `limit` and `offset` for large lists
- **Caching**: Consider caching agent lists locally
- **Debouncing**: Debounce API calls for real-time updates

### 5. User Experience
- **Loading States**: Show loading indicators during API calls
- **Error Messages**: Display user-friendly error messages
- **Optimistic Updates**: Update UI immediately, rollback on errors

## Migration from Redux Implementation

### Step 1: Remove Redux Dependencies
```typescript
// Before
import { useSelector, useDispatch } from 'react-redux'
import { createAgent, listAgents } from '../store/agents'

// After
import { apiRequest } from '../services/api'
```

### Step 2: Replace Redux Hooks
```typescript
// Before
const agents = useSelector(state => state.agents.list)
const dispatch = useDispatch()

// After
const [agents, setAgents] = useState<AgentEntity[]>([])
```

### Step 3: Replace Action Dispatches
```typescript
// Before
dispatch(createAgent(agentData))

// After
const newAgent = await apiRequest<AgentEntity>('/v1/agents', {
  method: 'POST',
  body: JSON.stringify(agentData)
})
setAgents(prev => [...prev, newAgent])
```

## Conclusion

This new API-based approach provides:
- **Better Performance**: Database storage with efficient queries
- **Real-time Streaming**: AI SDK compatible message streaming
- **Scalability**: Proper pagination and resource management
- **Flexibility**: Session-level configuration overrides
- **Reliability**: Proper error handling and status management

The migration from Redux to direct API integration simplifies the data flow and provides better control over agent interactions.