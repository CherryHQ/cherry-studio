import { describe, expect, it } from 'vitest'

import {
  AgentTransformSchema,
  LegacyMessageRowSchema,
  SessionTransformSchema,
  transformBlocksToMessageData
} from '../AgentMappings'

// ============================================================================
// Agent Transform
// ============================================================================

describe('AgentTransformSchema', () => {
  const validAgent = {
    id: 'agent-1',
    type: 'claude-code',
    name: 'Test Agent',
    description: 'A test agent',
    model: 'claude-sonnet-4-6',
    plan_model: 'claude-opus-4-6',
    small_model: 'claude-haiku-4-5-20251001',
    accessible_paths: '["/Users/test/project"]',
    instructions: '{"key":"value"}',
    mcps: '["mcp-1","mcp-2"]',
    allowed_tools: '["tool-a"]',
    configuration: '{"avatar":"🤖"}',
    sort_order: 3,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-06-01T00:00:00.000Z'
  }

  it('should transform a complete agent row', () => {
    const result = AgentTransformSchema.safeParse(validAgent)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data).toStrictEqual({
      id: 'agent-1',
      type: 'claude-code',
      name: 'Test Agent',
      description: 'A test agent',
      model: 'claude-sonnet-4-6',
      planModel: 'claude-opus-4-6',
      smallModel: 'claude-haiku-4-5-20251001',
      accessiblePaths: ['/Users/test/project'],
      instructions: { key: 'value' },
      mcps: ['mcp-1', 'mcp-2'],
      allowedTools: ['tool-a'],
      configuration: { avatar: '🤖' },
      sortOrder: 3
    })
  })

  it('should handle minimal agent (only required fields)', () => {
    const result = AgentTransformSchema.safeParse({
      id: 'agent-2',
      type: 'claude-code',
      name: 'Minimal',
      model: 'claude-sonnet-4-6',
      sort_order: 0,
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-01T00:00:00.000Z'
    })
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.planModel).toBeNull()
    expect(result.data.smallModel).toBeNull()
    expect(result.data.mcps).toBeNull()
    expect(result.data.allowedTools).toBeNull()
    expect(result.data.configuration).toBeNull()
    expect(result.data.accessiblePaths).toBeNull()
    expect(result.data.instructions).toBeNull()
  })

  it('should parse JSON string fields', () => {
    const result = AgentTransformSchema.safeParse({
      ...validAgent,
      mcps: '["a","b","c"]'
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mcps).toEqual(['a', 'b', 'c'])
    }
  })

  it('should handle already-parsed JSON fields', () => {
    const result = AgentTransformSchema.safeParse({
      ...validAgent,
      mcps: ['already', 'parsed']
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mcps).toEqual(['already', 'parsed'])
    }
  })

  it('should handle malformed JSON gracefully', () => {
    const result = AgentTransformSchema.safeParse({
      ...validAgent,
      mcps: '{broken json'
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mcps).toBeNull()
    }
  })

  it('should handle null optional fields', () => {
    const result = AgentTransformSchema.safeParse({
      ...validAgent,
      description: null,
      plan_model: null,
      small_model: null,
      accessible_paths: null,
      instructions: null,
      mcps: null,
      allowed_tools: null,
      configuration: null
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.description).toBeNull()
      expect(result.data.planModel).toBeNull()
      expect(result.data.mcps).toBeNull()
    }
  })

  it('should reject missing required fields', () => {
    expect(AgentTransformSchema.safeParse({ id: 'x' }).success).toBe(false)
    expect(AgentTransformSchema.safeParse({ id: 'x', type: 'claude-code' }).success).toBe(false)
    expect(AgentTransformSchema.safeParse({ id: 'x', type: 'claude-code', name: 'y' }).success).toBe(false)
  })

  it('should reject empty id', () => {
    expect(AgentTransformSchema.safeParse({ ...validAgent, id: '' }).success).toBe(false)
  })

  it('should pass through unknown fields without error', () => {
    const result = AgentTransformSchema.safeParse({
      ...validAgent,
      unknown_field: 'should not break'
    })
    expect(result.success).toBe(true)
  })

  it('should default sort_order to 0 when missing', () => {
    const { sort_order: _, ...withoutSort } = validAgent
    const result = AgentTransformSchema.safeParse(withoutSort)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sortOrder).toBe(0)
    }
  })
})

// ============================================================================
// Session Transform
// ============================================================================

describe('SessionTransformSchema', () => {
  const validSession = {
    id: 'session-1',
    agent_id: 'agent-1',
    agent_type: 'claude-code',
    name: 'Test Session',
    description: null,
    model: 'claude-sonnet-4-6',
    plan_model: null,
    small_model: null,
    accessible_paths: null,
    instructions: null,
    mcps: null,
    allowed_tools: null,
    slash_commands: '[{"command":"/help"}]',
    configuration: null,
    sort_order: 0,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z'
  }

  it('should transform a session row with snake_case → camelCase', () => {
    const result = SessionTransformSchema.safeParse(validSession)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.id).toBe('session-1')
    expect(result.data.agentId).toBe('agent-1')
    expect(result.data.agentType).toBe('claude-code')
    expect(result.data.slashCommands).toEqual([{ command: '/help' }])
  })

  it('should parse slash_commands JSON string', () => {
    const result = SessionTransformSchema.safeParse({
      ...validSession,
      slash_commands: '[{"command":"/status"},{"command":"/help"}]'
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.slashCommands).toHaveLength(2)
    }
  })

  it('should reject missing agent_id', () => {
    const { agent_id: _, ...noAgentId } = validSession
    expect(SessionTransformSchema.safeParse(noAgentId).success).toBe(false)
  })
})

// ============================================================================
// Message Row Schema
// ============================================================================

describe('LegacyMessageRowSchema', () => {
  it('should parse a message row with JSON content string', () => {
    const row = {
      id: 1,
      session_id: 'session-1',
      role: 'user',
      content: JSON.stringify({
        message: { id: 'msg-1', role: 'user', content: 'Hello' },
        blocks: [{ type: 'main_text', content: 'Hello', createdAt: 1700000000000 }]
      }),
      agent_session_id: 'sdk-session-1',
      metadata: null,
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-01T00:00:00.000Z'
    }

    const result = LegacyMessageRowSchema.safeParse(row)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.content?.message.id).toBe('msg-1')
    expect(result.data.content?.blocks).toHaveLength(1)
    expect(result.data.content?.blocks[0].type).toBe('main_text')
  })

  it('should handle null content gracefully', () => {
    const row = {
      id: 2,
      session_id: 'session-1',
      role: 'assistant',
      content: null,
      agent_session_id: '',
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-01T00:00:00.000Z'
    }

    const result = LegacyMessageRowSchema.safeParse(row)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.content).toBeNull()
    }
  })

  it('should handle malformed content JSON', () => {
    const row = {
      id: 3,
      session_id: 'session-1',
      role: 'user',
      content: '{not valid json',
      agent_session_id: '',
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-01T00:00:00.000Z'
    }

    const result = LegacyMessageRowSchema.safeParse(row)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.content).toBeNull()
    }
  })

  it('should default agent_session_id to empty string', () => {
    const row = {
      id: 4,
      session_id: 'session-1',
      role: 'user',
      content: null,
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-01T00:00:00.000Z'
    }

    const result = LegacyMessageRowSchema.safeParse(row)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agent_session_id).toBe('')
    }
  })
})

// ============================================================================
// Block Transform
// ============================================================================

describe('transformBlocksToMessageData', () => {
  it('should convert legacy blocks to MessageData format', () => {
    const blocks = [
      { type: 'main_text', content: 'Hello world', createdAt: 1700000000000 },
      { type: 'thinking', content: 'Let me think...', createdAt: 1700000000001, thinkingMs: 500 }
    ]

    const result = transformBlocksToMessageData(blocks)

    expect(result.blocks).toHaveLength(2)
    expect(result.blocks[0].type).toBe('main_text')
    expect(result.blocks[0]).toHaveProperty('content', 'Hello world')
    expect(result.blocks[1].type).toBe('thinking')
  })

  it('should handle empty blocks array', () => {
    const result = transformBlocksToMessageData([])
    expect(result.blocks).toEqual([])
  })

  it('should filter out blocks without type', () => {
    const blocks = [
      { type: 'main_text', content: 'valid', createdAt: 1700000000000 },
      { content: 'no type field' },
      null,
      undefined,
      { type: 'thinking', content: 'also valid', createdAt: 1700000000001, thinkingMs: 100 }
    ]

    const result = transformBlocksToMessageData(blocks as any[])
    expect(result.blocks).toHaveLength(2)
  })

  it('should preserve all block-specific fields', () => {
    const blocks = [
      {
        type: 'tool',
        toolId: 'tool-1',
        toolName: 'Read',
        arguments: { path: '/foo' },
        content: 'file contents',
        createdAt: 1700000000000
      }
    ]

    const result = transformBlocksToMessageData(blocks)
    expect(result.blocks).toHaveLength(1)
    const block = result.blocks[0]
    expect(block.type).toBe('tool')
    expect(block).toHaveProperty('toolId', 'tool-1')
    expect(block).toHaveProperty('toolName', 'Read')
  })
})
