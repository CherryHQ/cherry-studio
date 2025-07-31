import { agentManagementService } from '@renderer/services/AgentManagementService'
import { loggerService } from '@renderer/services/LoggerService'
import type {
  AgentResponse,
  CreateAgentInput,
  CreateSessionInput,
  SessionResponse,
  SessionStatus,
  UpdateAgentInput,
  UpdateSessionInput
} from '@types'
import { message } from 'antd'
import { useCallback, useEffect, useState } from 'react'

const logger = loggerService.withContext('UseAgentManagement')

export interface UseAgentManagementReturn {
  // Agents
  agents: AgentResponse[]
  currentAgent: AgentResponse | null
  loadingAgents: boolean
  createAgent: (input: CreateAgentInput) => Promise<AgentResponse | null>
  updateAgent: (input: UpdateAgentInput) => Promise<AgentResponse | null>
  deleteAgent: (id: string) => Promise<boolean>
  refreshAgents: () => Promise<void>
  setCurrentAgent: (agent: AgentResponse | null) => void

  // Sessions
  sessions: SessionResponse[]
  currentSession: SessionResponse | null
  loadingSessions: boolean
  createSession: (input: CreateSessionInput) => Promise<SessionResponse | null>
  updateSession: (input: UpdateSessionInput) => Promise<SessionResponse | null>
  updateSessionStatus: (id: string, status: SessionStatus) => Promise<boolean>
  deleteSession: (id: string) => Promise<boolean>
  refreshSessions: () => Promise<void>
  setCurrentSession: (session: SessionResponse | null) => void
}

export function useAgentManagement(): UseAgentManagementReturn {
  // Agent state
  const [agents, setAgents] = useState<AgentResponse[]>([])
  const [currentAgent, setCurrentAgent] = useState<AgentResponse | null>(null)
  const [loadingAgents, setLoadingAgents] = useState(false)

  // Session state
  const [sessions, setSessions] = useState<SessionResponse[]>([])
  const [currentSession, setCurrentSession] = useState<SessionResponse | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(false)

  // Agent operations
  const refreshAgents = useCallback(async () => {
    setLoadingAgents(true)
    try {
      const result = await agentManagementService.listAgents()
      if (result.success && result.data) {
        setAgents(result.data.items)
      } else {
        logger.error('Failed to load agents:', { error: result.error })
        message.error('Failed to load agents')
      }
    } catch (error) {
      logger.error('Error loading agents:', { error })
      message.error('Error loading agents')
    } finally {
      setLoadingAgents(false)
    }
  }, [])

  const createAgent = useCallback(
    async (input: CreateAgentInput): Promise<AgentResponse | null> => {
      try {
        const result = await agentManagementService.createAgent(input)
        if (result.success && result.data) {
          await refreshAgents()
          message.success('Agent created successfully')
          return result.data
        } else {
          message.error(result.error || 'Failed to create agent')
          return null
        }
      } catch (error) {
        logger.error('Error creating agent:', { error })
        message.error('Error creating agent')
        return null
      }
    },
    [refreshAgents]
  )

  const updateAgent = useCallback(
    async (input: UpdateAgentInput): Promise<AgentResponse | null> => {
      try {
        const result = await agentManagementService.updateAgent(input)
        if (result.success && result.data) {
          await refreshAgents()
          message.success('Agent updated successfully')
          // Update current agent if it's the one being updated
          if (currentAgent?.id === input.id) {
            setCurrentAgent(result.data)
          }
          return result.data
        } else {
          message.error(result.error || 'Failed to update agent')
          return null
        }
      } catch (error) {
        logger.error('Error updating agent:', { error })
        message.error('Error updating agent')
        return null
      }
    },
    [refreshAgents, currentAgent]
  )

  const deleteAgent = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const result = await agentManagementService.deleteAgent(id)
        if (result.success) {
          await refreshAgents()
          message.success('Agent deleted successfully')
          // Clear current agent if it's the one being deleted
          if (currentAgent?.id === id) {
            setCurrentAgent(null)
          }
          return true
        } else {
          message.error(result.error || 'Failed to delete agent')
          return false
        }
      } catch (error) {
        logger.error('Error deleting agent:', { error })
        message.error('Error deleting agent')
        return false
      }
    },
    [refreshAgents, currentAgent]
  )

  // Session operations
  const refreshSessions = useCallback(async () => {
    setLoadingSessions(true)
    try {
      const result = await agentManagementService.listSessions()
      if (result.success && result.data) {
        setSessions(result.data.items)
      } else {
        logger.error('Failed to load sessions:', { error: result.error })
        message.error('Failed to load sessions')
      }
    } catch (error) {
      logger.error('Error loading sessions:', { error })
      message.error('Error loading sessions')
    } finally {
      setLoadingSessions(false)
    }
  }, [])

  const createSession = useCallback(
    async (input: CreateSessionInput): Promise<SessionResponse | null> => {
      try {
        const result = await agentManagementService.createSession(input)
        if (result.success && result.data) {
          await refreshSessions()
          message.success('Session created successfully')
          return result.data
        } else {
          message.error(result.error || 'Failed to create session')
          return null
        }
      } catch (error) {
        logger.error('Error creating session:', { error })
        message.error('Error creating session')
        return null
      }
    },
    [refreshSessions]
  )

  const updateSession = useCallback(
    async (input: UpdateSessionInput): Promise<SessionResponse | null> => {
      try {
        const result = await agentManagementService.updateSession(input)
        if (result.success && result.data) {
          await refreshSessions()
          message.success('Session updated successfully')
          // Update current session if it's the one being updated
          if (currentSession?.id === input.id) {
            setCurrentSession(result.data)
          }
          return result.data
        } else {
          message.error(result.error || 'Failed to update session')
          return null
        }
      } catch (error) {
        logger.error('Error updating session:', { error })
        message.error('Error updating session')
        return null
      }
    },
    [refreshSessions, currentSession]
  )

  const updateSessionStatus = useCallback(
    async (id: string, status: SessionStatus): Promise<boolean> => {
      try {
        const result = await agentManagementService.updateSessionStatus(id, status)
        if (result.success) {
          await refreshSessions()
          // Update current session status if it's the one being updated
          if (currentSession?.id === id) {
            setCurrentSession((prev) => (prev ? { ...prev, status } : null))
          }
          return true
        } else {
          message.error(result.error || 'Failed to update session status')
          return false
        }
      } catch (error) {
        logger.error('Error updating session status:', { error })
        message.error('Error updating session status')
        return false
      }
    },
    [refreshSessions, currentSession]
  )

  const deleteSession = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const result = await agentManagementService.deleteSession(id)
        if (result.success) {
          await refreshSessions()
          message.success('Session deleted successfully')
          // Clear current session if it's the one being deleted
          if (currentSession?.id === id) {
            setCurrentSession(null)
          }
          return true
        } else {
          message.error(result.error || 'Failed to delete session')
          return false
        }
      } catch (error) {
        logger.error('Error deleting session:', { error })
        message.error('Error deleting session')
        return false
      }
    },
    [refreshSessions, currentSession]
  )

  // Load initial data
  useEffect(() => {
    refreshAgents()
    refreshSessions()
  }, [refreshAgents, refreshSessions])

  return {
    // Agents
    agents,
    currentAgent,
    loadingAgents,
    createAgent,
    updateAgent,
    deleteAgent,
    refreshAgents,
    setCurrentAgent,

    // Sessions
    sessions,
    currentSession,
    loadingSessions,
    createSession,
    updateSession,
    updateSessionStatus,
    deleteSession,
    refreshSessions,
    setCurrentSession
  }
}
