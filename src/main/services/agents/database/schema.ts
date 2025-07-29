/**
 * SQL schema definitions for AI Agent system
 * All table creation and migration queries are centralized here
 */

export const AgentSchema = {
  // Table creation queries
  createTables: {
    agents: `
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        system_prompt TEXT NOT NULL,
        model TEXT NOT NULL,
        tools TEXT, -- JSON string for tool configurations
        knowledges TEXT, -- JSON string for knowledge base references
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `,

    sessions: `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL, -- 'running', 'completed', 'failed', 'stopped'
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ended_at DATETIME,
        FOREIGN KEY (agent_id) REFERENCES agents (id)
      )
    `,

    sessionLogs: `
      CREATE TABLE IF NOT EXISTS session_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        level TEXT NOT NULL, -- 'info', 'warn', 'error', 'debug'
        message TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions (id)
      )
    `
  },

  // Index creation queries for performance
  createIndexes: {
    agentName: 'CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name)',
    sessionAgentId: 'CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id)',
    sessionStatus: 'CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)',
    sessionLogSessionId: 'CREATE INDEX IF NOT EXISTS idx_session_logs_session_id ON session_logs(session_id)',
    sessionLogLevel: 'CREATE INDEX IF NOT EXISTS idx_session_logs_level ON session_logs(level)',
    sessionLogTimestamp: 'CREATE INDEX IF NOT EXISTS idx_session_logs_timestamp ON session_logs(timestamp)'
  }
}