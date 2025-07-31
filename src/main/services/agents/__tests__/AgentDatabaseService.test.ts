import { Client, createClient } from '@libsql/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { AgentDatabaseService } from '../AgentDatabaseService'

describe('AgentDatabaseService', () => {
  let service: AgentDatabaseService
  let db: Client

  beforeEach(async () => {
    // Create in-memory database for testing
    db = createClient({
      url: ':memory:'
    })
    service = new AgentDatabaseService(db)
  })

  describe('Schema Creation', () => {
    it('should create agents table with correct schema', async () => {
      await service.initializeSchema()
      
      // Check if agents table exists and has correct structure
      const result = await db.execute(`
        SELECT sql FROM sqlite_master 
        WHERE type='table' AND name='agents'
      `)
      
      expect(result.rows).toHaveLength(1)
      const sql = result.rows[0].sql as string
      expect(sql).toContain('id TEXT PRIMARY KEY')
      expect(sql).toContain('name TEXT UNIQUE NOT NULL')
      expect(sql).toContain('description TEXT')
      expect(sql).toContain('system_prompt TEXT NOT NULL')
      expect(sql).toContain('model TEXT NOT NULL')
      expect(sql).toContain('tools TEXT') // JSON string
      expect(sql).toContain('knowledges TEXT') // JSON string
      expect(sql).toContain('created_at DATETIME DEFAULT CURRENT_TIMESTAMP')
      expect(sql).toContain('updated_at DATETIME DEFAULT CURRENT_TIMESTAMP')
    })

    it('should create sessions table with correct schema', async () => {
      await service.initializeSchema()
      
      const result = await db.execute(`
        SELECT sql FROM sqlite_master 
        WHERE type='table' AND name='sessions'
      `)
      
      expect(result.rows).toHaveLength(1)
      const sql = result.rows[0].sql as string
      expect(sql).toContain('id TEXT PRIMARY KEY')
      expect(sql).toContain('agent_id TEXT NOT NULL')
      expect(sql).toContain('status TEXT NOT NULL')
      expect(sql).toContain('started_at DATETIME DEFAULT CURRENT_TIMESTAMP')
      expect(sql).toContain('ended_at DATETIME')
      expect(sql).toContain('FOREIGN KEY (agent_id) REFERENCES agents (id)')
    })

    it('should create session_logs table with correct schema', async () => {
      await service.initializeSchema()
      
      const result = await db.execute(`
        SELECT sql FROM sqlite_master 
        WHERE type='table' AND name='session_logs'
      `)
      
      expect(result.rows).toHaveLength(1)
      const sql = result.rows[0].sql as string
      expect(sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT')
      expect(sql).toContain('session_id TEXT NOT NULL')
      expect(sql).toContain('level TEXT NOT NULL')
      expect(sql).toContain('message TEXT NOT NULL')
      expect(sql).toContain('timestamp DATETIME DEFAULT CURRENT_TIMESTAMP')
      expect(sql).toContain('FOREIGN KEY (session_id) REFERENCES sessions (id)')
    })

    it('should create proper indexes for performance', async () => {
      await service.initializeSchema()
      
      // Check for indexes on agents table
      const agentIndexes = await db.execute(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND tbl_name='agents'
      `)
      
      const indexNames = agentIndexes.rows.map(row => row.name)
      expect(indexNames).toContain('idx_agents_name')
      
      // Check for indexes on sessions table
      const sessionIndexes = await db.execute(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND tbl_name='sessions'
      `)
      
      const sessionIndexNames = sessionIndexes.rows.map(row => row.name)
      expect(sessionIndexNames).toContain('idx_sessions_agent_id')
      expect(sessionIndexNames).toContain('idx_sessions_status')
    })
  })

  describe('Constraint Enforcement', () => {
    it('should enforce unique constraint on agent names', async () => {
      await service.initializeSchema()
      
      // Insert first agent
      await db.execute(`
        INSERT INTO agents (id, name, description, system_prompt, model, tools, knowledges)
        VALUES ('1', 'Test Agent', 'Description', 'System prompt', 'gpt-4', '[]', '[]')
      `)
      
      // Try to insert duplicate name - should fail
      await expect(
        db.execute(`
          INSERT INTO agents (id, name, description, system_prompt, model, tools, knowledges)
          VALUES ('2', 'Test Agent', 'Different description', 'Different prompt', 'gpt-3.5-turbo', '[]', '[]')
        `)
      ).rejects.toThrow()
    })

    it('should enforce foreign key constraint on sessions', async () => {
      await service.initializeSchema()
      
      // Try to insert session with non-existent agent_id - should fail
      await expect(
        db.execute(`
          INSERT INTO sessions (id, agent_id, status)
          VALUES ('session1', 'non-existent-agent', 'running')
        `)
      ).rejects.toThrow()
    })

    it('should enforce required fields', async () => {
      await service.initializeSchema()
      
      // Try to insert agent without required fields - should fail
      await expect(
        db.execute(`
          INSERT INTO agents (id, description)
          VALUES ('1', 'Description only')
        `)
      ).rejects.toThrow()
    })
  })

  describe('Data Validation', () => {
    it('should reject invalid JSON in tools field', async () => {
      await service.initializeSchema()
      
      // This test will validate JSON format in the service layer
      await expect(
        service.validateAgentData({
          id: '1',
          name: 'Test Agent',
          description: 'Description',
          system_prompt: 'System prompt',
          model: 'gpt-4',
          tools: 'invalid json',
          knowledges: '[]'
        })
      ).rejects.toThrow('Invalid JSON format in tools field')
    })

    it('should reject invalid JSON in knowledges field', async () => {
      await service.initializeSchema()
      
      await expect(
        service.validateAgentData({
          id: '1',
          name: 'Test Agent',
          description: 'Description',
          system_prompt: 'System prompt',
          model: 'gpt-4',
          tools: '[]',
          knowledges: 'invalid json'
        })
      ).rejects.toThrow('Invalid JSON format in knowledges field')
    })
  })
})