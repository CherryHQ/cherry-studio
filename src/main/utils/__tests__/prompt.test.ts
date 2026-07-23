import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      warn: vi.fn(),
      error: vi.fn()
    }))
  }
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'PreferenceService') {
        return {
          get: vi.fn((key: string) => {
            if (key === 'app.user.name') return 'TestUser'
            if (key === 'app.language') return 'en-US'
            return undefined
          })
        }
      }
      return undefined
    })
  }
}))

import os from 'node:os'

import { containsSupportedVariables, replacePromptVariables } from '../prompt'

describe('main/utils/prompt', () => {
  const mockDate = new Date('2024-06-15T14:30:00Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(mockDate)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('containsSupportedVariables', () => {
    it('returns true when prompt contains supported variables', () => {
      expect(containsSupportedVariables('Hello {{date}}')).toBe(true)
      expect(containsSupportedVariables('Time is {{time}}')).toBe(true)
      expect(containsSupportedVariables('Now: {{datetime}}')).toBe(true)
    })

    it('returns false when prompt contains no supported variables', () => {
      expect(containsSupportedVariables('Hello world')).toBe(false)
    })
  })

  describe('replacePromptVariables', () => {
    it('replaces {{date}} with day-level granularity', async () => {
      const result = await replacePromptVariables('Date: {{date}}')
      expect(result).toBe(
        `Date: ${mockDate.toLocaleDateString(undefined, {
          weekday: 'short',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric'
        })}`
      )
    })

    it('replaces {{time}} with minute-level granularity (no seconds)', async () => {
      const result = await replacePromptVariables('Time: {{time}}')
      expect(result).toBe(
        `Time: ${mockDate.toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: 'numeric'
        })}`
      )
    })

    it('replaces {{datetime}} without seconds', async () => {
      const result = await replacePromptVariables('DateTime: {{datetime}}')
      expect(result).toBe(
        `DateTime: ${mockDate.toLocaleString(undefined, {
          weekday: 'short',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric'
        })}`
      )
    })

    it('replaces {{username}} from PreferenceService', async () => {
      const result = await replacePromptVariables('User: {{username}}')
      expect(result).toBe('User: TestUser')
    })

    it('replaces {{system}} with os platform', async () => {
      const result = await replacePromptVariables('OS: {{system}}')
      expect(result).toBe(`OS: ${os.platform()}`)
    })

    it('replaces {{language}} from PreferenceService', async () => {
      const result = await replacePromptVariables('Lang: {{language}}')
      expect(result).toBe('Lang: en-US')
    })

    it('replaces {{arch}} with os architecture', async () => {
      const result = await replacePromptVariables('Arch: {{arch}}')
      expect(result).toBe(`Arch: ${os.arch()}`)
    })

    it('replaces {{model_name}} with supplied name', async () => {
      const result = await replacePromptVariables('Model: {{model_name}}', 'claude-3')
      expect(result).toBe('Model: claude-3')
    })

    it('replaces {{model_name}} with fallback when not supplied', async () => {
      const result = await replacePromptVariables('Model: {{model_name}}')
      expect(result).toBe('Model: Unknown Model')
    })

    it('replaces all variables in a complex prompt', async () => {
      const prompt = 'Date: {{date}}, Time: {{time}}, User: {{username}}'
      const result = await replacePromptVariables(prompt, 'gpt-4')
      expect(result).toContain('Date:')
      expect(result).toContain('Time:')
      expect(result).toContain('User: TestUser')
    })

    it('returns non-string input unchanged', async () => {
      const result = await replacePromptVariables(null as any)
      expect(result).toBe(null)
    })

    it('produces deterministic output with a fixed clock', async () => {
      const prompt = 'Date: {{date}}, Time: {{time}}, DateTime: {{datetime}}'
      const result1 = await replacePromptVariables(prompt)
      const result2 = await replacePromptVariables(prompt)
      expect(result1).toBe(result2)
    })
  })
})
