Overview

Implement comprehensive CRUD APIs for agent, agentSession, and agentSessionLogs management
in Cherry Studio's API server using RESTful URL conventions.

Architecture Overview

1. Service Layer

- Create AgentService class in src/main/services/agents/AgentService.ts
  - Handles database operations using SQL queries from db.ts
  - Manages SQLite database initialization and connections
  - Provides business logic for agent operations

2. API Routes

- Create route files in src/main/apiServer/routes/:
  - agents.ts - Agent CRUD endpoints
  - sessions.ts - Session CRUD endpoints
  - session-logs.ts - Session logs CRUD endpoints

3. Database Integration

- Use SQLite with @libsql/client (following MemoryService pattern)
- Database location: userData/agents.db
- Leverage existing SQL queries in src/main/services/agents/db.ts

Implementation Steps

Phase 1: Database Service Setup

1. Create AgentService class with database initialization
2. Implement database connection management
3. Add database initialization to main process startup
4. Create helper methods for JSON field serialization/deserialization

Phase 2: Agent CRUD Operations

1. Implement service methods:

- createAgent(agent: Omit<AgentEntity, 'id' | 'created_at' | 'updated_at'>)
- getAgent(id: string)
- listAgents(options?: { limit?: number, offset?: number })
- updateAgent(id: string, updates: Partial<AgentEntity>)
- deleteAgent(id: string)

2. Create API routes:

- POST /v1/agents - Create agent
- GET /v1/agents - List all agents
- GET /v1/agents/:agentId - Get agent by ID
- PUT /v1/agents/:agentId - Update agent
- DELETE /v1/agents/:agentId - Delete agent

Phase 3: Session CRUD Operations

1. Implement service methods:

- createSession(session: Omit<AgentSessionEntity, 'id' | 'created_at' | 'updated_at'>)
- getSession(id: string)
- listSessions(agentId?: string, options?: { status?: SessionStatus, limit?: number,
  offset?: number })
- updateSession(id: string, updates: Partial<AgentSessionEntity>)
- updateSessionStatus(id: string, status: SessionStatus)
- deleteSession(id: string)
- getSessionWithAgent(id: string) - Get session with merged agent configuration

2. Create API routes (RESTful nested resources):

- POST /v1/agents/:agentId/sessions - Create session for specific agent
- GET /v1/agents/:agentId/sessions - List sessions for specific agent
- GET /v1/agents/:agentId/sessions/:sessionId - Get specific session
- PUT /v1/agents/:agentId/sessions/:sessionId - Update session
- PATCH /v1/agents/:agentId/sessions/:sessionId/status - Update session status
- DELETE /v1/agents/:agentId/sessions/:sessionId - Delete session

Additional convenience endpoints:

- GET /v1/sessions - List all sessions (across all agents)
- GET /v1/sessions/:sessionId - Get session by ID (without agent context)

Phase 4: Session Logs CRUD Operations

1. Implement service methods:

- createSessionLog(log: Omit<SessionLogEntity, 'id' | 'created_at' | 'updated_at'>)
- getSessionLog(id: number)
- listSessionLogs(sessionId: string, options?: { limit?: number, offset?: number })
- updateSessionLog(id: number, updates: { content?: any, metadata?: any })
- deleteSessionLog(id: number)
- getSessionLogTree(sessionId: string) - Get logs with parent-child relationships
- bulkCreateSessionLogs(logs: Array<...>) - Batch insert logs

2. Create API routes (RESTful nested resources):

- POST /v1/agents/:agentId/sessions/:sessionId/logs - Create log entry
- GET /v1/agents/:agentId/sessions/:sessionId/logs - List logs for session
- GET /v1/agents/:agentId/sessions/:sessionId/logs/:logId - Get specific log
- PUT /v1/agents/:agentId/sessions/:sessionId/logs/:logId - Update log
- DELETE /v1/agents/:agentId/sessions/:sessionId/logs/:logId - Delete log
- POST /v1/agents/:agentId/sessions/:sessionId/logs/bulk - Bulk create logs

Additional convenience endpoints:

- GET /v1/sessions/:sessionId/logs - Get logs without agent context
- GET /v1/session-logs/:logId - Get specific log by ID

Phase 5: Route Organization

1. Mount routes with proper nesting:
   // In app.ts
   apiRouter.use('/agents', agentsRoutes)
   // agentsRoutes will handle:
   // - /agents/_
   // - /agents/:agentId/sessions/_
   // - /agents/:agentId/sessions/:sessionId/logs/\*

// Convenience routes
apiRouter.use('/sessions', sessionsRoutes)
apiRouter.use('/session-logs', sessionLogsRoutes)

2. Use Express Router mergeParams for nested routes:
   // In agents.ts
   const sessionsRouter = express.Router({ mergeParams: true })
   router.use('/:agentId/sessions', sessionsRouter)

Phase 6: OpenAPI Documentation

1. Add Swagger schemas for new entities:

- AgentEntity schema
- AgentSessionEntity schema
- SessionLogEntity schema
- Request/Response schemas

2. Document all new endpoints with:

- Clear path parameters (agentId, sessionId, logId)
- Request body schemas
- Response examples
- Error responses
- Proper grouping by resource

Phase 7: Validation & Error Handling

1. Add path parameter validation:

- Validate agentId exists before processing session requests
- Validate sessionId belongs to agentId
- Validate logId belongs to sessionId

2. Implement middleware for:

- Request validation using express-validator
- Resource existence checks
- Permission validation (future consideration)
- Transaction support for complex operations

Phase 8: Testing

1. Unit tests for service methods
2. Integration tests for API endpoints
3. Test nested resource validation
4. Test cascading deletes
5. Test transaction rollbacks

File Structure

src/
├── main/
│ └── services/
│ └── agents/
│ ├── index.ts (existing)
│ ├── db.ts (existing)
│ └── AgentService.ts (new)
├── main/
│ └── apiServer/
│ └── routes/
│ ├── agents.ts (new - includes nested routes)
│ ├── sessions.ts (new - convenience endpoints)
│ └── session-logs.ts (new - convenience endpoints)
└── renderer/
└── src/
└── types/
└── agent.ts (existing)

API Endpoint Summary

Agent Endpoints

- POST /v1/agents
- GET /v1/agents
- GET /v1/agents/:agentId
- PUT /v1/agents/:agentId
- DELETE /v1/agents/:agentId

Session Endpoints (RESTful)

- POST /v1/agents/:agentId/sessions
- GET /v1/agents/:agentId/sessions
- GET /v1/agents/:agentId/sessions/:sessionId
- PUT /v1/agents/:agentId/sessions/:sessionId
- PATCH /v1/agents/:agentId/sessions/:sessionId/status
- DELETE /v1/agents/:agentId/sessions/:sessionId

Session Convenience Endpoints

- GET /v1/sessions
- GET /v1/sessions/:sessionId

Session Log Endpoints (RESTful)

- POST /v1/agents/:agentId/sessions/:sessionId/logs
- GET /v1/agents/:agentId/sessions/:sessionId/logs
- GET /v1/agents/:agentId/sessions/:sessionId/logs/:logId
- PUT /v1/agents/:agentId/sessions/:sessionId/logs/:logId
- DELETE /v1/agents/:agentId/sessions/:sessionId/logs/:logId
- POST /v1/agents/:agentId/sessions/:sessionId/logs/bulk

Session Log Convenience Endpoints

- GET /v1/sessions/:sessionId/logs
- GET /v1/session-logs/:logId

Key Considerations

- Follow RESTful URL conventions with proper resource nesting
- Validate parent-child relationships in nested routes
- Use Express Router with mergeParams for nested routing
- Implement proper cascading deletes
- Add transaction support for data consistency
- Follow existing patterns from MemoryService
- Ensure backward compatibility
- Add rate limiting for write operations

Dependencies

- @libsql/client - SQLite database client
- express-validator - Request validation
- swagger-jsdoc - API documentation
- Existing types from @types/agent.ts
