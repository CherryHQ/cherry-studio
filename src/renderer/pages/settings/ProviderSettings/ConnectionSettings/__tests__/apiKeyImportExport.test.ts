import { describe, expect, it } from 'vitest'

import type { ApiKeyEntry } from '@shared/data/types/provider'

import {
  detectFormat,
  generateCSVContent,
  generateJSONExport,
  parseCSVContent,
  parseENVContent,
  parseJSONContent
} from '../apiKeyImportExport'

describe('apiKeyImportExport', () => {
  describe('parseCSVContent', () => {
    it('parses basic CSV with key column only', () => {
      const csv = 'key\nsk-123\nsk-456'
      const result = parseCSVContent(csv)
      expect(result).toHaveLength(2)
      expect(result[0].key).toBe('sk-123')
      expect(result[1].key).toBe('sk-456')
    })

    it('parses CSV with all columns', () => {
      const csv = 'key,label,tier,renewalAnchor,renewalTimezone,note\nsk-123,Prod,paid,2024-01-01,UTC,Main'
      const result = parseCSVContent(csv)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        key: 'sk-123',
        label: 'Prod',
        tier: 'paid',
        renewalAnchor: '2024-01-01',
        renewalTimezone: 'UTC',
        note: 'Main'
      })
    })

    it('handles quoted CSV values', () => {
      const csv = 'key,label\n"sk-123","My, Key"'
      const result = parseCSVContent(csv)
      expect(result[0].label).toBe('My, Key')
    })

    it('skips empty rows', () => {
      const csv = 'key\nsk-123\n\nsk-456'
      const result = parseCSVContent(csv)
      expect(result).toHaveLength(2)
    })

    it('returns empty array if header missing key column', () => {
      const csv = 'label\nProd'
      const result = parseCSVContent(csv)
      expect(result).toHaveLength(0)
    })
  })

  describe('parseENVContent', () => {
    it('parses ENV-style key=value pairs', () => {
      const env = 'OPENAI_0_KEY=sk-123\nOPENAI_0_LABEL=Prod'
      const result = parseENVContent(env)
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('sk-123')
      expect(result[0].label).toBe('Prod')
    })

    it('handles multiple keys', () => {
      const env = 'OPENAI_0_KEY=sk-1\nOPENAI_1_KEY=sk-2'
      const result = parseENVContent(env)
      expect(result).toHaveLength(2)
      expect(result[0].key).toBe('sk-1')
      expect(result[1].key).toBe('sk-2')
    })

    it('skips comments', () => {
      const env = '# Comment\nOPENAI_0_KEY=sk-123'
      const result = parseENVContent(env)
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('sk-123')
    })

    it('ignores keys without KEY field', () => {
      const env = 'OPENAI_0_LABEL=Prod'
      const result = parseENVContent(env)
      expect(result).toHaveLength(0)
    })
  })

  describe('generateCSVContent', () => {
    it('generates CSV from keys', () => {
      const keys: ApiKeyEntry[] = [
        {
          id: '1',
          key: 'sk-123',
          label: 'Prod',
          isEnabled: true,
          tier: 'paid'
        }
      ]
      const csv = generateCSVContent(keys)
      expect(csv).toContain('key,label,tier')
      expect(csv).toContain('sk-123')
      expect(csv).toContain('Prod')
    })

    it('escapes quoted CSV values', () => {
      const keys: ApiKeyEntry[] = [
        {
          id: '1',
          key: 'sk-123',
          label: 'My, Key',
          isEnabled: true
        }
      ]
      const csv = generateCSVContent(keys)
      expect(csv).toContain('"My, Key"')
    })
  })

  describe('generateJSONExport', () => {
    it('generates JSON with metadata', () => {
      const keys: ApiKeyEntry[] = [
        {
          id: '1',
          key: 'sk-123',
          label: 'Prod',
          isEnabled: true
        }
      ]
      const json = generateJSONExport(keys)
      expect(json.version).toBe(1)
      expect(json.timestamp).toBeDefined()
      expect(json.keys).toHaveLength(1)
      expect(json.keys[0].key).toBe('sk-123')
    })
  })

  describe('parseJSONContent', () => {
    it('parses JSON export format', () => {
      const json = JSON.stringify({
        version: 1,
        timestamp: new Date().toISOString(),
        keys: [{ key: 'sk-123', label: 'Prod' }]
      })
      const result = parseJSONContent(json)
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('sk-123')
    })

    it('returns empty array for invalid JSON', () => {
      const result = parseJSONContent('invalid')
      expect(result).toHaveLength(0)
    })

    it('validates version', () => {
      const json = JSON.stringify({
        version: 2,
        keys: [{ key: 'sk-123' }]
      })
      const result = parseJSONContent(json)
      expect(result).toHaveLength(0)
    })
  })

  describe('detectFormat', () => {
    it('detects CSV format', () => {
      expect(detectFormat('keys.csv')).toBe('csv')
    })

    it('detects ENV format', () => {
      expect(detectFormat('.env')).toBe('env')
      expect(detectFormat('.env.local')).toBe('env')
    })

    it('detects JSON format', () => {
      expect(detectFormat('keys.json')).toBe('json')
    })

    it('defaults to CSV for unknown format', () => {
      expect(detectFormat('keys.txt')).toBe('csv')
    })
  })
})
