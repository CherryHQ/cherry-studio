import { Type, type SystemMessage } from '@earendil-works/pi-ai'
import { measureSystemContext } from '@earendil-works/pi-ai/utils/context-usage'
import {
  estimateMessageTokens,
  estimateSystemCharacters as estimateAiCharacters
} from '@earendil-works/pi-ai/utils/estimate'
import { getSystemMessageText } from '@earendil-works/pi-ai/utils/text'
import { getCurrentSystemMessage } from '@earendil-works/pi-ai/utils/transcript'
import {
  estimateSystemCharacters as estimatePiCharacters,
  estimateTokens,
  SessionManager
} from '@earendil-works/pi-coding-agent'
import { expect, it } from 'vitest'

it.each([
  [estimateTokens, estimatePiCharacters, ''],
  [estimateMessageTokens, estimateAiCharacters, '\n\n']
] as const)(
  'partitions the native estimate without counting metadata or deferred schemas as occupancy',
  (estimate, estimateCharacters, separator) => {
    const system: SystemMessage = {
      role: 'system',
      content: 'Base',
      timestamp: 0,
      sections: { prompt: 'Second part', memory: 'Remember this', deleted: null },
      toolsAdded: [{ name: 'ordinary_name', description: 'External lookup', parameters: Type.Object({}) }],
      contextSources: {
        sections: { memory: { kind: 'memory-files' } },
        tools: { ordinary_name: { kind: 'mcp-tools', source: 'server' } }
      }
    }
    const deferred = [{ name: 'mcp_looking_name', description: 'Actually a system tool', parameters: Type.Object({}) }]
    const parts = measureSystemContext(system, deferred, estimateCharacters, separator)
    expect(parts.filter((part) => part.state !== 'deferred').reduce((sum, part) => sum + part.tokens, 0)).toBe(
      estimate(system)
    )
    expect(parts.find((part) => part.id === 'ordinary_name')).toMatchObject({
      kind: 'mcp-tools',
      source: 'server',
      state: 'loaded'
    })
    expect(parts.find((part) => part.id === 'mcp_looking_name')).toMatchObject({
      kind: 'system-tools',
      state: 'deferred'
    })
    expect(parts.some((part) => part.id === 'deleted')).toBe(false)
    expect(getSystemMessageText(system)).toBe('Base\n\nSecond part\n\nRemember this')
  }
)

it('restores section provenance with the selected native branch and drops it when an unannotated section replaces the text', () => {
  const manager = SessionManager.inMemory('/workspace')
  const at = manager.appendMessage({
    role: 'system',
    content: '',
    timestamp: 1,
    sections: { memory: 'Original memory' },
    contextSources: { sections: { memory: { kind: 'memory-files' } }, tools: {} }
  })
  manager.appendMessage({ role: 'system', content: '', sections: { memory: 'Opaque replacement' }, timestamp: 2 })
  expect(
    getCurrentSystemMessage(manager.buildSessionProjection().messages)?.contextSources?.sections.memory
  ).toBeUndefined()
  manager.branch(at)
  const restored = getCurrentSystemMessage(manager.buildSessionProjection().messages)
  expect(restored?.sections?.memory).toBe('Original memory')
  expect(restored?.contextSources?.sections.memory).toEqual({ kind: 'memory-files' })
})
