import { Client, createClient } from '@libsql/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentService } from '../index'
import { AgentDatabaseService } from '../AgentDatabaseService'

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

describe('AgentService', () => {
  let service: AgentService
  let db: Client
  let dbService: AgentDatabaseService

  beforeEach(async () => {
    // Create in-memory database for testing
    db = createClient({
      url: ':memory:'
    })
    dbService = new AgentDatabaseService(db)
    await dbService.initializeSchema()
    
    service = new AgentService(dbService)
  })

  describe('Agent CRUD Operations', () => {
    describe('createAgent', () => {
      it('should create a new agent with valid data', async () => {
        const agentData = {
          name: 'Test Agent',
          description: 'A test agent',
          system_prompt: 'You are a helpful assistant',
          model: 'gpt-4',
          tools: [],
          knowledges: []
        }

        const agent = await service.createAgent(agentData)

        expect(agent.id).toBeDefined()
        expect(agent.name).toBe('Test Agent')
        expect(agent.description).toBe('A test agent')
        expect(agent.system_prompt).toBe('You are a helpful assistant')
        expect(agent.model).toBe('gpt-4')
        expect(agent.status).toBe('idle')
        expect(agent.created_at).toBeInstanceOf(Date)
        expect(agent.updated_at).toBeInstanceOf(Date)
      })

      it('should reject agent with duplicate name', async () => {
        const agentData = {
          name: 'Duplicate Agent',
          system_prompt: 'You are a helpful assistant',
          model: 'gpt-4',
          tools: [],
          knowledges: []
        }

        await service.createAgent(agentData)

        await expect(service.createAgent(agentData))
          .rejects.toThrow('Agent with name "Duplicate Agent" already exists')
      })

      it('should validate agent data before creation', async () => {
        const invalidAgentData = {
          name: '',
          system_prompt: 'You are a helpful assistant',
          model: 'gpt-4',
          tools: [],
          knowledges: []
        }

        await expect(service.createAgent(invalidAgentData))
          .rejects.toThrow('Agent name cannot be empty')
      })

      it('should sanitize input data', async () => {
        const agentData = {
          name: '  Test Agent  ',
          description: '<script>alert("xss")</script>Description',
          system_prompt: 'You are a helpful assistant',
          model: 'gpt-4',
          tools: [],
          knowledges: []
        }

        const agent = await service.createAgent(agentData)

        expect(agent.name).toBe('Test Agent')
        expect(agent.description).not.toContain('<script>')
      })
    })

    describe('getAgent', () => {
      it('should retrieve an existing agent', async () => {
        const agentData = {
          name: 'Test Agent',
          system_prompt: 'You are a helpful assistant',
          model: 'gpt-4',
          tools: [],
          knowledges: []
        }

        const createdAgent = await service.createAgent(agentData)
        const retrievedAgent = await service.getAgent(createdAgent.id)

        expect(retrievedAgent).toBeDefined()
        expect(retrievedAgent.id).toBe(createdAgent.id)
        expect(retrievedAgent.name).toBe('Test Agent')
      })

      it('should return null for non-existent agent', async () => {
        const agent = await service.getAgent('non-existent-id')
        expect(agent).toBeNull()
      })
    })

    describe('updateAgent', () => {
      it('should update an existing agent', async () => {
        const agentData = {
          name: 'Original Agent',
          system_prompt: 'You are a helpful assistant',
          model: 'gpt-4',
          tools: [],
          knowledges: []
        }

        const createdAgent = await service.createAgent(agentData)
        
        // Wait a bit to ensure timestamp difference
        await new Promise(resolve => setTimeout(resolve, 10))
        
        const updatedAgent = await service.updateAgent(createdAgent.id, {
          name: 'Updated Agent',
          description: 'Updated description'
        })

        expect(updatedAgent.name).toBe('Updated Agent')
        expect(updatedAgent.description).toBe('Updated description')
        expect(updatedAgent.updated_at.getTime()).toBeGreaterThan(createdAgent.updated_at.getTime())
      })

      it('should reject update with duplicate name', async () => {
        const agent1Data = {
          name: 'Agent 1',
          system_prompt: 'You are a helpful assistant',
          model: 'gpt-4',
          tools: [],
          knowledges: []
        }

        const agent2Data = {
          name: 'Agent 2',
          system_prompt: 'You are a helpful assistant',
          model: 'gpt-4',
          tools: [],
          knowledges: []
        }

        const agent1 = await service.createAgent(agent1Data)
        const agent2 = await service.createAgent(agent2Data)

        await expect(service.updateAgent(agent2.id, { name: 'Agent 1' }))
          .rejects.toThrow('Agent with name "Agent 1" already exists')
      })

      it('should throw error for non-existent agent', async () => {
        await expect(service.updateAgent('non-existent-id', { name: 'Updated' }))
          .rejects.toThrow('Agent not found')
      })
    })

    describe('deleteAgent', () => {
      it('should delete an existing agent', async () => {
        const agentData = {
          name: 'To Delete Agent',
          system_prompt: 'You are a helpful assistant',
          model: 'gpt-4',
          tools: [],
          knowledges: []
        }

        const createdAgent = await service.createAgent(agentData)
        await service.deleteAgent(createdAgent.id)

        const retrievedAgent = await service.getAgent(createdAgent.id)
        expect(retrievedAgent).toBeNull()
      })

      it('should prevent deletion of agent with active sessions', async () => {
        const agentData = {
          name: 'Agent with Sessions',
          system_prompt: 'You are a helpful assistant',
          model: 'gpt-4',
          tools: [],
          knowledges: []
        }

        const agent = await service.createAgent(agentData)
        
        // Create an active session for this agent
        await db.execute(
          'INSERT INTO sessions (id, agent_id, status) VALUES (?, ?, ?)',
          ['session-1', agent.id, 'running']
        )

        await expect(service.deleteAgent(agent.id))
          .rejects.toThrow('Cannot delete agent with active sessions')
      })

      it('should throw error for non-existent agent', async () => {
        await expect(service.deleteAgent('non-existent-id'))
          .rejects.toThrow('Agent not found')
      })
    })

    describe('listAgents', () => {
      it('should return empty list when no agents exist', async () => {
        const agents = await service.listAgents()
        expect(agents).toEqual([])
      })

      it('should return all agents', async () => {
        const agent1Data = {
          name: 'Agent 1',
          system_prompt: 'You are a helpful assistant',
          model: 'gpt-4',
          tools: [],
          knowledges: []
        }

        const agent2Data = {
          name: 'Agent 2',
          system_prompt: 'You are a helpful assistant',
          model: 'gpt-3.5-turbo',
          tools: [],
          knowledges: []
        }

        await service.createAgent(agent1Data)
        await service.createAgent(agent2Data)

        const agents = await service.listAgents()
        expect(agents).toHaveLength(2)
        
        const agentNames = agents.map(agent => agent.name).sort()
        expect(agentNames).toEqual(['Agent 1', 'Agent 2'])
      })

      it('should support pagination', async () => {
        // Create multiple agents
        for (let i = 1; i <= 5; i++) {
          await service.createAgent({
            name: `Agent ${i}`,
            system_prompt: 'You are a helpful assistant',
            model: 'gpt-4',
            tools: [],
            knowledges: []
          })
        }

        const firstPage = await service.listAgents({ limit: 2, offset: 0 })
        const secondPage = await service.listAgents({ limit: 2, offset: 2 })

        expect(firstPage).toHaveLength(2)
        expect(secondPage).toHaveLength(2)
        expect(firstPage[0].name).not.toBe(secondPage[0].name)
      })

      it('should support filtering by name', async () => {
        await service.createAgent({
          name: 'Code Agent',
          system_prompt: 'You are a coding assistant',
          model: 'gpt-4',
          tools: [],
          knowledges: []
        })

        await service.createAgent({
          name: 'Chat Agent',
          system_prompt: 'You are a chat assistant',
          model: 'gpt-4',
          tools: [],
          knowledges: []
        })

        const filteredAgents = await service.listAgents({ nameFilter: 'Code' })
        expect(filteredAgents).toHaveLength(1)
        expect(filteredAgents[0].name).toBe('Code Agent')
      })
    })
  })

  describe('Business Logic', () => {
    it('should generate unique IDs for agents', async () => {
      const agentData = {
        name: 'Test Agent',
        system_prompt: 'You are a helpful assistant',
        model: 'gpt-4',
        tools: [],
        knowledges: []
      }

      const agent1 = await service.createAgent(agentData)
      agentData.name = 'Test Agent 2'
      const agent2 = await service.createAgent(agentData)

      expect(agent1.id).not.toBe(agent2.id)
      expect(agent1.id).toMatch(/^[a-f0-9-]{36}$/) // UUID format
      expect(agent2.id).toMatch(/^[a-f0-9-]{36}$/) // UUID format
    })

    it('should set default status to idle for new agents', async () => {
      const agentData = {
        name: 'Test Agent',
        system_prompt: 'You are a helpful assistant',
        model: 'gpt-4',
        tools: [],
        knowledges: []
      }

      const agent = await service.createAgent(agentData)
      expect(agent.status).toBe('idle')
    })

    it('should update timestamps correctly', async () => {
      const agentData = {
        name: 'Test Agent',
        system_prompt: 'You are a helpful assistant',
        model: 'gpt-4',
        tools: [],
        knowledges: []
      }

      const agent = await service.createAgent(agentData)
      
      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10))
      
      const updatedAgent = await service.updateAgent(agent.id, { name: 'Updated Agent' })
      
      expect(updatedAgent.updated_at.getTime()).toBeGreaterThan(agent.updated_at.getTime())
      expect(updatedAgent.created_at.getTime()).toBe(agent.created_at.getTime())
    })
  })

  describe('Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      // Close the database connection to simulate error
      await db.close()

      const agentData = {
        name: 'Test Agent',
        system_prompt: 'You are a helpful assistant',
        model: 'gpt-4',
        tools: [],
        knowledges: []
      }

      await expect(service.createAgent(agentData))
        .rejects.toThrow()
    })
  })
})