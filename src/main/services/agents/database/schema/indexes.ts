/**
 * Database index definitions
 */

export const IndexDefinitions = {
  // Agent indexes
  agentsName: 'CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name)',
  agentsType: 'CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type)',
  agentsModel: 'CREATE INDEX IF NOT EXISTS idx_agents_model ON agents(model)',
  agentsPlanModel: 'CREATE INDEX IF NOT EXISTS idx_agents_plan_model ON agents(plan_model)',
  agentsSmallModel: 'CREATE INDEX IF NOT EXISTS idx_agents_small_model ON agents(small_model)',
  agentsPermissionMode: 'CREATE INDEX IF NOT EXISTS idx_agents_permission_mode ON agents(permission_mode)',
  agentsCreatedAt: 'CREATE INDEX IF NOT EXISTS idx_agents_created_at ON agents(created_at)',

  // Session indexes
  sessionsName: 'CREATE INDEX IF NOT EXISTS idx_sessions_name ON sessions(name)',
  sessionsStatus: 'CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)',
  sessionsCreatedAt: 'CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at)',
  sessionsExternalSessionId:
    'CREATE INDEX IF NOT EXISTS idx_sessions_external_session_id ON sessions(external_session_id)',
  sessionsMainAgentId: 'CREATE INDEX IF NOT EXISTS idx_sessions_main_agent_id ON sessions(main_agent_id)',
  sessionsModel: 'CREATE INDEX IF NOT EXISTS idx_sessions_model ON sessions(model)',
  sessionsPlanModel: 'CREATE INDEX IF NOT EXISTS idx_sessions_plan_model ON sessions(plan_model)',
  sessionsSmallModel: 'CREATE INDEX IF NOT EXISTS idx_sessions_small_model ON sessions(small_model)',

  // Session log indexes
  sessionLogsSessionId: 'CREATE INDEX IF NOT EXISTS idx_session_logs_session_id ON session_logs(session_id)',
  sessionLogsParentId: 'CREATE INDEX IF NOT EXISTS idx_session_logs_parent_id ON session_logs(parent_id)',
  sessionLogsRole: 'CREATE INDEX IF NOT EXISTS idx_session_logs_role ON session_logs(role)',
  sessionLogsType: 'CREATE INDEX IF NOT EXISTS idx_session_logs_type ON session_logs(type)',
  sessionLogsCreatedAt: 'CREATE INDEX IF NOT EXISTS idx_session_logs_created_at ON session_logs(created_at)',
  sessionLogsUpdatedAt: 'CREATE INDEX IF NOT EXISTS idx_session_logs_updated_at ON session_logs(updated_at)'
} as const
