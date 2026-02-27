import type { MemoryItem } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MemoryProcessor } from '../MemoryProcessor'

// Mock dependencies
vi.mock('../MemoryService', () => ({
  default: {
    getInstance: vi.fn(() => ({
      add: vi.fn(),
      search: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    }))
  }
}))

vi.mock('@renderer/store/settings', () => {
  const noop = vi.fn()
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'initialState') {
          return {}
        }
        return noop
      }
    }
  )
})

vi.mock('@renderer/hooks/useModel', () => ({
  getModel: vi.fn()
}))

vi.mock('../ApiService', () => ({
  fetchGenerate: vi.fn()
}))

describe('MemoryProcessor - extractUserPreferences', () => {
  let processor: MemoryProcessor

  beforeEach(() => {
    processor = new MemoryProcessor()
  })

  it('returns empty array for empty memories', () => {
    expect(processor.extractUserPreferences([])).toEqual([])
  })

  it('detects beginner technical depth', () => {
    const memories: MemoryItem[] = [{ id: '1', memory: '我是编程新手' }]
    const result = processor.extractUserPreferences(memories)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('technical_depth')
    expect(result[0].value).toBe('beginner')
  })

  it('detects expert technical depth', () => {
    const memories: MemoryItem[] = [{ id: '1', memory: '我是一名资深开发者' }]
    const result = processor.extractUserPreferences(memories)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('technical_depth')
    expect(result[0].value).toBe('expert')
  })

  it('detects concise response preference', () => {
    const memories: MemoryItem[] = [{ id: '1', memory: '我喜欢简洁的回答' }]
    const result = processor.extractUserPreferences(memories)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('response_length')
    expect(result[0].value).toBe('concise')
  })

  it('detects detailed response preference', () => {
    const memories: MemoryItem[] = [{ id: '1', memory: '请给我详细的解释' }]
    const result = processor.extractUserPreferences(memories)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('response_length')
    expect(result[0].value).toBe('detailed')
  })

  it('detects commented code style', () => {
    const memories: MemoryItem[] = [{ id: '1', memory: '代码要有注释' }]
    const result = processor.extractUserPreferences(memories)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('code_style')
    expect(result[0].value).toBe('commented')
  })

  it('detects minimal code style with concise response length', () => {
    const memories: MemoryItem[] = [{ id: '1', memory: '我想要简洁代码风格' }]
    const result = processor.extractUserPreferences(memories)
    // Note: '简洁代码' also matches '简洁' so both preferences are detected
    expect(result).toHaveLength(2)
    const codeStyle = result.find((p) => p.type === 'code_style')
    const responseLength = result.find((p) => p.type === 'response_length')
    expect(codeStyle?.value).toBe('minimal')
    expect(responseLength?.value).toBe('concise')
  })

  it('detects Chinese language preference', () => {
    const memories: MemoryItem[] = [{ id: '1', memory: '请用中文回答' }]
    const result = processor.extractUserPreferences(memories)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('language')
    expect(result[0].value).toBe('中文')
  })

  it('extracts multiple preferences from single memory', () => {
    const memories: MemoryItem[] = [{ id: '1', memory: '我是新手，请给我简洁的回答' }]
    const result = processor.extractUserPreferences(memories)
    expect(result).toHaveLength(2)
    const types = result.map((p) => p.type)
    expect(types).toContain('technical_depth')
    expect(types).toContain('response_length')
  })
})
