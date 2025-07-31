import { Client, createClient } from '@libsql/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionService } from '../SessionService'
import { AgentDatabaseService } from '../AgentDatabaseService'
import { SessionStatus, LogLevel } from '../../../../renderer/src/types/agent'

// Mock logger to avoid log output in tests
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      verbose: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

describe('SessionService', () => {
  let service: SessionService
  let db: Client
  let dbService: AgentDatabaseService
  let testAgentId: string

  beforeEach(async () => {
    // Create in-memory database for testing
    db = createClient({
      url: ':memory:'
    })
    dbService = new AgentDatabaseService(db)
    await dbService.initializeSchema()
    
    service = new SessionService(dbService)

    // Create a test agent for session tests
    testAgentId = 'test-agent-id'
    await db.execute(
      'INSERT INTO agents (id, name, system_prompt, model, tools, knowledges) VALUES (?, ?, ?, ?, ?, ?)',
      [testAgentId, 'Test Agent', 'You are a test agent', 'gpt-4', '[]', '[]']
    )
  })

  describe('Session CRUD Operations', () => {
    describe('createSession', () => {
      it('should create a new session with valid agent ID', async () => {
        const sessionData = {
          agent_id: testAgentId
        }

        const session = await service.createSession(sessionData)

        expect(session.id).toBeDefined()
        expect(session.agent_id).toBe(testAgentId)
        expect(session.status).toBe(SessionStatus.RUNNING)
        expect(session.started_at).toBeInstanceOf(Date)
        expect(session.ended_at).toBeNull()
      })

      it('should reject session creation with non-existent agent ID', async () => {
        const sessionData = {
          agent_id: 'non-existent-agent'
        }

        await expect(service.createSession(sessionData))
          .rejects.toThrow('Agent not found')
      })

      it('should validate session data before creation', async () => {
        const invalidSessionData = {
          agent_id: ''
        }

        await expect(service.createSession(invalidSessionData))
          .rejects.toThrow('Agent ID cannot be empty')
      })

      it('should generate unique session IDs', async () => {
        const sessionData = { agent_id: testAgentId }

        const session1 = await service.createSession(sessionData)
        const session2 = await service.createSession(sessionData)

        expect(session1.id).not.toBe(session2.id)
        expect(session1.id).toMatch(/^[a-f0-9-]{36}$/) // UUID format
        expect(session2.id).toMatch(/^[a-f0-9-]{36}$/) // UUID format
      })
    })

    describe('getSession', () => {
      it('should retrieve an existing session', async () => {
        const sessionData = { agent_id: testAgentId }
        const createdSession = await service.createSession(sessionData)
        
        const retrievedSession = await service.getSession(createdSession.id)

        expect(retrievedSession).toBeDefined()
        expect(retrievedSession!.id).toBe(createdSession.id)
        expect(retrievedSession!.agent_id).toBe(testAgentId)
        expect(retrievedSession!.status).toBe(SessionStatus.RUNNING)
      })

      it('should return null for non-existent session', async () => {
        const session = await service.getSession('non-existent-id')
        expect(session).toBeNull()
      })
    })

    describe('updateSessionStatus', () => {
      it('should update session status to completed', async () => {
        const sessionData = { agent_id: testAgentId }
        const createdSession = await service.createSession(sessionData)
        
        // Wait a bit to ensure timestamp difference
        await new Promise(resolve => setTimeout(resolve, 10))
        
        const updatedSession = await service.updateSessionStatus(
          createdSession.id, 
          SessionStatus.COMPLETED
        )

        expect(updatedSession.status).toBe(SessionStatus.COMPLETED)
        expect(updatedSession.ended_at).toBeInstanceOf(Date)
        expect(updatedSession.ended_at!.getTime()).toBeGreaterThan(createdSession.started_at.getTime())
      })

      it('should update session status to failed', async () => {
        const sessionData = { agent_id: testAgentId }
        const createdSession = await service.createSession(sessionData)
        
        const updatedSession = await service.updateSessionStatus(
          createdSession.id, 
          SessionStatus.FAILED
        )

        expect(updatedSession.status).toBe(SessionStatus.FAILED)
        expect(updatedSession.ended_at).toBeInstanceOf(Date)
      })

      it('should throw error for non-existent session', async () => {
        await expect(service.updateSessionStatus('non-existent-id', SessionStatus.COMPLETED))
          .rejects.toThrow('Session not found')
      })

      it('should validate session status before update', async () => {
        const sessionData = { agent_id: testAgentId }
        const createdSession = await service.createSession(sessionData)

        await expect(service.updateSessionStatus(createdSession.id, 'invalid-status' as SessionStatus))
          .rejects.toThrow('Invalid session status')
      })
    })

    describe('listSessions', () => {
      it('should return empty list when no sessions exist', async () => {
        const sessions = await service.listSessions()
        expect(sessions).toEqual([])
      })

      it('should return all sessions', async () => {
        const sessionData = { agent_id: testAgentId }
        
        await service.createSession(sessionData)
        await service.createSession(sessionData)

        const sessions = await service.listSessions()
        expect(sessions).toHaveLength(2)
        expect(sessions.every(s => s.agent_id === testAgentId)).toBe(true)
      })

      it('should support pagination', async () => {
        const sessionData = { agent_id: testAgentId }
        
        // Create multiple sessions
        for (let i = 1; i <= 5; i++) {
          await service.createSession(sessionData)
        }

        const firstPage = await service.listSessions({ limit: 2, offset: 0 })
        const secondPage = await service.listSessions({ limit: 2, offset: 2 })

        expect(firstPage).toHaveLength(2)
        expect(secondPage).toHaveLength(2)
        expect(firstPage[0].id).not.toBe(secondPage[0].id)
      })

      it('should support filtering by agent ID', async () => {
        // Create another test agent
        const agent2Id = 'test-agent-2'
        await db.execute(
          'INSERT INTO agents (id, name, system_prompt, model, tools, knowledges) VALUES (?, ?, ?, ?, ?, ?)',
          [agent2Id, 'Test Agent 2', 'You are another test agent', 'gpt-4', '[]', '[]']
        )

        await service.createSession({ agent_id: testAgentId })
        await service.createSession({ agent_id: agent2Id })

        const filteredSessions = await service.listSessions({ agentId: testAgentId })
        expect(filteredSessions).toHaveLength(1)
        expect(filteredSessions[0].agent_id).toBe(testAgentId)
      })

      it('should support filtering by status', async () => {
        const sessionData = { agent_id: testAgentId }
        
        const session1 = await service.createSession(sessionData)
        const session2 = await service.createSession(sessionData)
        
        // Complete one session
        await service.updateSessionStatus(session1.id, SessionStatus.COMPLETED)

        const runningSessions = await service.listSessions({ status: SessionStatus.RUNNING })
        const completedSessions = await service.listSessions({ status: SessionStatus.COMPLETED })

        expect(runningSessions).toHaveLength(1)
        expect(runningSessions[0].id).toBe(session2.id)
        expect(completedSessions).toHaveLength(1)
        expect(completedSessions[0].id).toBe(session1.id)
      })
    })
  })

  describe('Session Logging', () => {
    describe('addSessionLog', () => {
      it('should add log entry to existing session', async () => {
        const sessionData = { agent_id: testAgentId }
        const session = await service.createSession(sessionData)

        const logData = {
          session_id: session.id,
          level: LogLevel.INFO,
          message: 'Test log message'
        }

        const log = await service.addSessionLog(logData)

        expect(log.id).toBeDefined()
        expect(log.session_id).toBe(session.id)
        expect(log.level).toBe(LogLevel.INFO)
        expect(log.message).toBe('Test log message')
        expect(log.timestamp).toBeInstanceOf(Date)
      })

      it('should validate log data before adding', async () => {
        const invalidLogData = {
          session_id: '',
          level: LogLevel.INFO,
          message: 'Test message'
        }

        await expect(service.addSessionLog(invalidLogData))
          .rejects.toThrow('Session ID cannot be empty')
      })

      it('should validate log level', async () => {
        const sessionData = { agent_id: testAgentId }
        const session = await service.createSession(sessionData)

        const invalidLogData = {
          session_id: session.id,
          level: 'invalid-level' as LogLevel,
          message: 'Test message'
        }

        await expect(service.addSessionLog(invalidLogData))
          .rejects.toThrow('Invalid log level')
      })

      it('should validate log message is not empty', async () => {
        const sessionData = { agent_id: testAgentId }
        const session = await service.createSession(sessionData)

        const invalidLogData = {
          session_id: session.id,
          level: LogLevel.INFO,
          message: ''
        }

        await expect(service.addSessionLog(invalidLogData))
          .rejects.toThrow('Log message cannot be empty')
      })

      it('should reject logs for non-existent session', async () => {
        const logData = {
          session_id: 'non-existent-session',
          level: LogLevel.INFO,
          message: 'Test message'
        }

        await expect(service.addSessionLog(logData))
          .rejects.toThrow('Session not found')
      })
    })

    describe('getSessionLogs', () => {
      it('should retrieve logs for a session', async () => {
        const sessionData = { agent_id: testAgentId }
        const session = await service.createSession(sessionData)

        // Add multiple logs
        await service.addSessionLog({
          session_id: session.id,
          level: LogLevel.INFO,
          message: 'First log'
        })
        
        await service.addSessionLog({
          session_id: session.id,
          level: LogLevel.ERROR,
          message: 'Second log'
        })

        const logs = await service.getSessionLogs(session.id)

        expect(logs).toHaveLength(2)
        expect(logs[0].message).toBe('First log')
        expect(logs[1].message).toBe('Second log')
        expect(logs.every(log => log.session_id === session.id)).toBe(true)
      })

      it('should return empty array for session with no logs', async () => {
        const sessionData = { agent_id: testAgentId }
        const session = await service.createSession(sessionData)

        const logs = await service.getSessionLogs(session.id)
        expect(logs).toEqual([])
      })

      it('should support pagination for logs', async () => {
        const sessionData = { agent_id: testAgentId }
        const session = await service.createSession(sessionData)

        // Add multiple logs
        for (let i = 1; i <= 5; i++) {
          await service.addSessionLog({
            session_id: session.id,
            level: LogLevel.INFO,
            message: `Log message ${i}`
          })
        }

        const firstPage = await service.getSessionLogs(session.id, { limit: 2, offset: 0 })
        const secondPage = await service.getSessionLogs(session.id, { limit: 2, offset: 2 })

        expect(firstPage).toHaveLength(2)
        expect(secondPage).toHaveLength(2)
        expect(firstPage[0].message).not.toBe(secondPage[0].message)
      })

      it('should support filtering logs by level', async () => {
        const sessionData = { agent_id: testAgentId }
        const session = await service.createSession(sessionData)

        await service.addSessionLog({
          session_id: session.id,
          level: LogLevel.INFO,
          message: 'Info log'
        })
        
        await service.addSessionLog({
          session_id: session.id,
          level: LogLevel.ERROR,
          message: 'Error log'
        })

        const errorLogs = await service.getSessionLogs(session.id, { level: LogLevel.ERROR })
        expect(errorLogs).toHaveLength(1)
        expect(errorLogs[0].level).toBe(LogLevel.ERROR)
        expect(errorLogs[0].message).toBe('Error log')
      })
    })
  })

  describe('Real-time Status Management', () => {
    it('should emit status updates when session status changes', async () => {
      const statusUpdates: any[] = []
      service.on('statusUpdate', (update) => {
        statusUpdates.push(update)
      })

      const sessionData = { agent_id: testAgentId }
      const session = await service.createSession(sessionData)

      await service.updateSessionStatus(session.id, SessionStatus.COMPLETED)

      expect(statusUpdates).toHaveLength(1)
      expect(statusUpdates[0]).toEqual({
        sessionId: session.id,
        status: SessionStatus.COMPLETED,
        timestamp: expect.any(Date)
      })
    })

    it('should handle concurrent status updates safely', async () => {
      const sessionData = { agent_id: testAgentId }
      const session = await service.createSession(sessionData)

      const promises = [
        service.updateSessionStatus(session.id, SessionStatus.COMPLETED),
        service.updateSessionStatus(session.id, SessionStatus.FAILED)
      ]

      // One should succeed, one should handle gracefully
      const results = await Promise.allSettled(promises)
      expect(results.some(r => r.status === 'fulfilled')).toBe(true)
    })
  })

  describe('Resource Limits Management', () => {
    it('should terminate session when resource limits are exceeded', async () => {
      const sessionData = { agent_id: testAgentId }
      const session = await service.createSession(sessionData)

      // Simulate resource limit exceeded
      const resourceLimits = {
        maxMemoryMB: 100,
        maxCpuPercent: 80,
        maxDurationMs: 60000
      }

      const currentUsage = {
        memoryMB: 150, // Exceeds limit
        cpuPercent: 75,
        durationMs: 30000
      }

      await service.checkResourceLimits(session.id, resourceLimits, currentUsage)

      const updatedSession = await service.getSession(session.id)
      expect(updatedSession!.status).toBe(SessionStatus.STOPPED)
      expect(updatedSession!.ended_at).toBeInstanceOf(Date)
    })

    it('should not terminate session when within resource limits', async () => {
      const sessionData = { agent_id: testAgentId }
      const session = await service.createSession(sessionData)

      const resourceLimits = {
        maxMemoryMB: 100,
        maxCpuPercent: 80,
        maxDurationMs: 60000
      }

      const currentUsage = {
        memoryMB: 75, // Within limit
        cpuPercent: 60,
        durationMs: 30000
      }

      await service.checkResourceLimits(session.id, resourceLimits, currentUsage)

      const updatedSession = await service.getSession(session.id)
      expect(updatedSession!.status).toBe(SessionStatus.RUNNING)
      expect(updatedSession!.ended_at).toBeNull()
    })

    it('should log resource limit violations', async () => {
      const sessionData = { agent_id: testAgentId }
      const session = await service.createSession(sessionData)

      const resourceLimits = {
        maxMemoryMB: 100,
        maxCpuPercent: 80,
        maxDurationMs: 60000
      }

      const currentUsage = {
        memoryMB: 150, // Exceeds limit
        cpuPercent: 75,
        durationMs: 30000
      }

      await service.checkResourceLimits(session.id, resourceLimits, currentUsage)

      const logs = await service.getSessionLogs(session.id)
      const resourceLog = logs.find(log => log.message.includes('Resource limit exceeded'))
      
      expect(resourceLog).toBeDefined()
      expect(resourceLog!.level).toBe(LogLevel.WARN)
    })
  })

  describe('Session Statistics', () => {
    it('should provide session statistics', async () => {
      const sessionData = { agent_id: testAgentId }
      
      const session1 = await service.createSession(sessionData)
      const session2 = await service.createSession(sessionData)
      await service.updateSessionStatus(session1.id, SessionStatus.COMPLETED)

      const stats = await service.getSessionStats()

      expect(stats.totalSessions).toBe(2)
      expect(stats.runningSessions).toBe(1)
      expect(stats.completedSessions).toBe(1)
      expect(stats.failedSessions).toBe(0)
      expect(stats.stoppedSessions).toBe(0)
    })

    it('should provide session statistics by agent', async () => {
      // Create another test agent
      const agent2Id = 'test-agent-2'
      await db.execute(
        'INSERT INTO agents (id, name, system_prompt, model, tools, knowledges) VALUES (?, ?, ?, ?, ?, ?)',
        [agent2Id, 'Test Agent 2', 'You are another test agent', 'gpt-4', '[]', '[]']
      )

      await service.createSession({ agent_id: testAgentId })
      await service.createSession({ agent_id: testAgentId })
      await service.createSession({ agent_id: agent2Id })

      const stats = await service.getSessionStatsByAgent(testAgentId)

      expect(stats.totalSessions).toBe(2)
      expect(stats.runningSessions).toBe(2)
    })
  })

  describe('Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      // Close the database connection to simulate error
      await db.close()

      const sessionData = { agent_id: testAgentId }

      await expect(service.createSession(sessionData))
        .rejects.toThrow()
    })

    it('should handle concurrent session operations safely', async () => {
      const sessionData = { agent_id: testAgentId }
      const session = await service.createSession(sessionData)

      // Try to add logs concurrently
      const logPromises = Array.from({ length: 10 }, (_, i) => 
        service.addSessionLog({
          session_id: session.id,
          level: LogLevel.INFO,
          message: `Concurrent log ${i}`
        })
      )

      const results = await Promise.allSettled(logPromises)
      expect(results.every(r => r.status === 'fulfilled')).toBe(true)

      const logs = await service.getSessionLogs(session.id)
      expect(logs).toHaveLength(10)
    })
  })
})