import { describe, expect, it } from 'vitest'
import {
  type Agent,
  type Session,
  type SessionLog,
  type AgentTemplate,
  AgentStatus,
  SessionStatus,
  LogLevel,
  validateAgent,
  validateSession,
  validateSessionLog,
  sanitizeAgentInput,
  isValidModelId
} from '../agent'

describe('Agent Type Definitions', () => {
  describe('Agent Interface', () => {
    it('should have all required fields defined', () => {
      const agent: Agent = {
        id: 'agent-1',
        name: 'Test Agent',
        description: 'A test agent',
        system_prompt: 'You are a helpful assistant',
        model: 'gpt-4',
        tools: [],
        knowledges: [],
        status: AgentStatus.IDLE,
        created_at: new Date(),
        updated_at: new Date()
      }

      expect(agent.id).toBe('agent-1')
      expect(agent.name).toBe('Test Agent')
      expect(agent.system_prompt).toBe('You are a helpful assistant')
      expect(agent.model).toBe('gpt-4')
      expect(Array.isArray(agent.tools)).toBe(true)
      expect(Array.isArray(agent.knowledges)).toBe(true)
      expect(agent.status).toBe(AgentStatus.IDLE)
    })

    it('should support optional description field', () => {
      const agentWithoutDescription: Agent = {
        id: 'agent-1',
        name: 'Test Agent',
        system_prompt: 'You are a helpful assistant',
        model: 'gpt-4',
        tools: [],
        knowledges: [],
        status: AgentStatus.IDLE,
        created_at: new Date(),
        updated_at: new Date()
      }

      expect(agentWithoutDescription.description).toBeUndefined()
    })
  })

  describe('Session Interface', () => {
    it('should have all required fields defined', () => {
      const session: Session = {
        id: 'session-1',
        agent_id: 'agent-1',
        status: SessionStatus.RUNNING,
        started_at: new Date(),
        ended_at: null
      }

      expect(session.id).toBe('session-1')
      expect(session.agent_id).toBe('agent-1')
      expect(session.status).toBe(SessionStatus.RUNNING)
      expect(session.started_at).toBeInstanceOf(Date)
      expect(session.ended_at).toBeNull()
    })
  })

  describe('SessionLog Interface', () => {
    it('should have all required fields defined', () => {
      const log: SessionLog = {
        id: 1,
        session_id: 'session-1',
        level: LogLevel.INFO,
        message: 'Agent started processing',
        timestamp: new Date()
      }

      expect(log.id).toBe(1)
      expect(log.session_id).toBe('session-1')
      expect(log.level).toBe(LogLevel.INFO)
      expect(log.message).toBe('Agent started processing')
      expect(log.timestamp).toBeInstanceOf(Date)
    })
  })

  describe('Enum Values', () => {
    it('should define AgentStatus enum correctly', () => {
      expect(AgentStatus.IDLE).toBe('idle')
      expect(AgentStatus.RUNNING).toBe('running')
      expect(AgentStatus.ERROR).toBe('error')
    })

    it('should define SessionStatus enum correctly', () => {
      expect(SessionStatus.RUNNING).toBe('running')
      expect(SessionStatus.COMPLETED).toBe('completed')
      expect(SessionStatus.FAILED).toBe('failed')
      expect(SessionStatus.STOPPED).toBe('stopped')
    })

    it('should define LogLevel enum correctly', () => {
      expect(LogLevel.DEBUG).toBe('debug')
      expect(LogLevel.INFO).toBe('info')
      expect(LogLevel.WARN).toBe('warn')
      expect(LogLevel.ERROR).toBe('error')
    })
  })
})

describe('Agent Validation', () => {
  describe('validateAgent', () => {
    it('should pass validation for valid agent', () => {
      const validAgent: Agent = {
        id: 'agent-1',
        name: 'Test Agent',
        description: 'A test agent',
        system_prompt: 'You are a helpful assistant',
        model: 'gpt-4',
        tools: [],
        knowledges: [],
        status: AgentStatus.IDLE,
        created_at: new Date(),
        updated_at: new Date()
      }

      expect(() => validateAgent(validAgent)).not.toThrow()
    })

    it('should reject agent with empty name', () => {
      const invalidAgent: Agent = {
        id: 'agent-1',
        name: '',
        system_prompt: 'You are a helpful assistant',
        model: 'gpt-4',
        tools: [],
        knowledges: [],
        status: AgentStatus.IDLE,
        created_at: new Date(),
        updated_at: new Date()
      }

      expect(() => validateAgent(invalidAgent)).toThrow('Agent name cannot be empty')
    })

    it('should reject agent with name longer than 100 characters', () => {
      const invalidAgent: Agent = {
        id: 'agent-1',
        name: 'A'.repeat(101),
        system_prompt: 'You are a helpful assistant',
        model: 'gpt-4',
        tools: [],
        knowledges: [],
        status: AgentStatus.IDLE,
        created_at: new Date(),
        updated_at: new Date()
      }

      expect(() => validateAgent(invalidAgent)).toThrow('Agent name cannot exceed 100 characters')
    })

    it('should reject agent with empty system prompt', () => {
      const invalidAgent: Agent = {
        id: 'agent-1',
        name: 'Test Agent',
        system_prompt: '',
        model: 'gpt-4',
        tools: [],
        knowledges: [],
        status: AgentStatus.IDLE,
        created_at: new Date(),
        updated_at: new Date()
      }

      expect(() => validateAgent(invalidAgent)).toThrow('System prompt cannot be empty')
    })

    it('should reject agent with invalid model ID', () => {
      const invalidAgent: Agent = {
        id: 'agent-1',
        name: 'Test Agent',
        system_prompt: 'You are a helpful assistant',
        model: 'invalid-model',
        tools: [],
        knowledges: [],
        status: AgentStatus.IDLE,
        created_at: new Date(),
        updated_at: new Date()
      }

      expect(() => validateAgent(invalidAgent)).toThrow('Invalid model ID')
    })
  })

  describe('validateSession', () => {
    it('should pass validation for valid session', () => {
      const validSession: Session = {
        id: 'session-1',
        agent_id: 'agent-1',
        status: SessionStatus.RUNNING,
        started_at: new Date(),
        ended_at: null
      }

      expect(() => validateSession(validSession)).not.toThrow()
    })

    it('should reject session with empty agent_id', () => {
      const invalidSession: Session = {
        id: 'session-1',
        agent_id: '',
        status: SessionStatus.RUNNING,
        started_at: new Date(),
        ended_at: null
      }

      expect(() => validateSession(invalidSession)).toThrow('Agent ID cannot be empty')
    })
  })

  describe('validateSessionLog', () => {
    it('should pass validation for valid session log', () => {
      const validLog: SessionLog = {
        id: 1,
        session_id: 'session-1',
        level: LogLevel.INFO,
        message: 'Agent started processing',
        timestamp: new Date()
      }

      expect(() => validateSessionLog(validLog)).not.toThrow()
    })

    it('should reject log with empty message', () => {
      const invalidLog: SessionLog = {
        id: 1,
        session_id: 'session-1',
        level: LogLevel.INFO,
        message: '',
        timestamp: new Date()
      }

      expect(() => validateSessionLog(invalidLog)).toThrow('Log message cannot be empty')
    })
  })
})

describe('Input Sanitization', () => {
  describe('sanitizeAgentInput', () => {
    it('should trim whitespace from string fields', () => {
      const input = {
        name: '  Test Agent  ',
        description: '  A test agent  ',
        system_prompt: '  You are a helpful assistant  '
      }

      const sanitized = sanitizeAgentInput(input)

      expect(sanitized.name).toBe('Test Agent')
      expect(sanitized.description).toBe('A test agent')
      expect(sanitized.system_prompt).toBe('You are a helpful assistant')
    })

    it('should remove dangerous HTML/script tags', () => {
      const input = {
        name: 'Test<script>alert("xss")</script>Agent',
        description: '<img src="x" onerror="alert(1)">Description',
        system_prompt: 'You are <script>evil()</script> helpful'
      }

      const sanitized = sanitizeAgentInput(input)

      expect(sanitized.name).not.toContain('<script>')
      expect(sanitized.description).not.toContain('onerror')
      expect(sanitized.system_prompt).not.toContain('<script>')
    })

    it('should handle Unicode characters properly', () => {
      const input = {
        name: 'Test Agent 🤖',
        description: 'AI助手',
        system_prompt: 'Vous êtes un assistant utile'
      }

      const sanitized = sanitizeAgentInput(input)

      expect(sanitized.name).toBe('Test Agent 🤖')
      expect(sanitized.description).toBe('AI助手')
      expect(sanitized.system_prompt).toBe('Vous êtes un assistant utile')
    })
  })
})

describe('Utility Functions', () => {
  describe('isValidModelId', () => {
    it('should return true for valid model IDs', () => {
      const validModels = [
        'gpt-4',
        'gpt-4-turbo',
        'gpt-3.5-turbo',
        'claude-3-sonnet',
        'claude-3-opus',
        'gemini-pro'
      ]

      validModels.forEach(model => {
        expect(isValidModelId(model)).toBe(true)
      })
    })

    it('should return false for invalid model IDs', () => {
      const invalidModels = [
        '',
        'invalid-model',
        'gpt-5',
        'unknown-model',
        null,
        undefined
      ]

      invalidModels.forEach(model => {
        expect(isValidModelId(model as any)).toBe(false)
      })
    })
  })
})