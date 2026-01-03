import { describe, expect, it } from 'vitest'

import type { Assistant, MCPServer } from '../../types'
import { getEffectiveMcpMode } from '../../types'

describe('getEffectiveMcpMode', () => {
  it('should return mcpMode when explicitly set to auto', () => {
    const assistant: Partial<Assistant> = { mcpMode: 'auto' }
    expect(getEffectiveMcpMode(assistant as Assistant)).toBe('auto')
  })

  it('should return disabled when mcpMode is explicitly disabled', () => {
    const assistant: Partial<Assistant> = { mcpMode: 'disabled' }
    expect(getEffectiveMcpMode(assistant as Assistant)).toBe('disabled')
  })

  it('should return manual when mcpMode is explicitly manual', () => {
    const assistant: Partial<Assistant> = { mcpMode: 'manual' }
    expect(getEffectiveMcpMode(assistant as Assistant)).toBe('manual')
  })

  it('should return manual when no mcpMode but mcpServers has items (backward compatibility)', () => {
    const assistant: Partial<Assistant> = {
      mcpServers: [{ id: 'test', name: 'Test Server', isActive: true }] as MCPServer[]
    }
    expect(getEffectiveMcpMode(assistant as Assistant)).toBe('manual')
  })

  it('should return disabled when no mcpMode and no mcpServers (backward compatibility)', () => {
    const assistant: Partial<Assistant> = {}
    expect(getEffectiveMcpMode(assistant as Assistant)).toBe('disabled')
  })

  it('should return disabled when no mcpMode and empty mcpServers (backward compatibility)', () => {
    const assistant: Partial<Assistant> = { mcpServers: [] }
    expect(getEffectiveMcpMode(assistant as Assistant)).toBe('disabled')
  })

  it('should prioritize explicit mcpMode over mcpServers presence', () => {
    const assistant: Partial<Assistant> = {
      mcpMode: 'disabled',
      mcpServers: [{ id: 'test', name: 'Test Server', isActive: true }] as MCPServer[]
    }
    expect(getEffectiveMcpMode(assistant as Assistant)).toBe('disabled')
  })

  it('should return auto when mcpMode is auto regardless of mcpServers', () => {
    const assistant: Partial<Assistant> = {
      mcpMode: 'auto',
      mcpServers: [{ id: 'test', name: 'Test Server', isActive: true }] as MCPServer[]
    }
    expect(getEffectiveMcpMode(assistant as Assistant)).toBe('auto')
  })
})
