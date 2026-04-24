import { BackupDomain } from '@shared/backup'
import { describe, expect, it } from 'vitest'

import {
  ALWAYS_STRIP_TABLES,
  DOMAIN_TABLE_MAP,
  getTablesForDomains,
  getTablesKeepSet,
  IMPORT_ORDER,
  INFRASTRUCTURE_TABLES
} from '../DomainRegistry'

describe('DomainRegistry', () => {
  describe('DOMAIN_TABLE_MAP', () => {
    it('has entries for all BackupDomain values', () => {
      const allDomains = Object.values(BackupDomain)
      for (const domain of allDomains) {
        expect(DOMAIN_TABLE_MAP).toHaveProperty(domain)
      }
    })

    it('maps TOPICS to topic, message, pin tables', () => {
      expect(DOMAIN_TABLE_MAP[BackupDomain.TOPICS]).toEqual(['topic', 'message', 'pin'])
    })

    it('maps FILE_STORAGE to empty array (filesystem only)', () => {
      expect(DOMAIN_TABLE_MAP[BackupDomain.FILE_STORAGE]).toEqual([])
    })

    it('maps AGENTS to all agent sub-tables', () => {
      const agentTables = DOMAIN_TABLE_MAP[BackupDomain.AGENTS]
      expect(agentTables).toContain('agent')
      expect(agentTables).toContain('agent_channel')
      expect(agentTables).toContain('agent_session')
      expect(agentTables.length).toBe(9)
    })

    it('maps ASSISTANTS to assistant + relation tables', () => {
      expect(DOMAIN_TABLE_MAP[BackupDomain.ASSISTANTS]).toEqual([
        'assistant',
        'assistant_mcp_server',
        'assistant_knowledge_base'
      ])
    })

    it('has no duplicate table names across all domains', () => {
      const allTables = Object.values(DOMAIN_TABLE_MAP).flat()
      const unique = new Set(allTables)
      expect(allTables.length).toBe(unique.size)
    })
  })

  describe('getTablesForDomains', () => {
    it('returns empty for empty input', () => {
      expect(getTablesForDomains([])).toEqual([])
    })

    it('returns tables for single domain', () => {
      expect(getTablesForDomains([BackupDomain.PREFERENCES])).toEqual(['preference'])
    })

    it('returns combined tables for multiple domains', () => {
      const tables = getTablesForDomains([BackupDomain.TAGS_GROUPS, BackupDomain.PREFERENCES])
      expect(tables).toContain('tag')
      expect(tables).toContain('entity_tag')
      expect(tables).toContain('group')
      expect(tables).toContain('preference')
    })
  })

  describe('getTablesKeepSet', () => {
    it('includes infrastructure tables', () => {
      const keepSet = getTablesKeepSet([BackupDomain.TOPICS])
      for (const t of INFRASTRUCTURE_TABLES) {
        expect(keepSet.has(t)).toBe(true)
      }
    })

    it('includes domain tables', () => {
      const keepSet = getTablesKeepSet([BackupDomain.TOPICS])
      expect(keepSet.has('topic')).toBe(true)
      expect(keepSet.has('message')).toBe(true)
      expect(keepSet.has('pin')).toBe(true)
    })

    it('does not include always-strip tables', () => {
      const keepSet = getTablesKeepSet(Object.values(BackupDomain))
      for (const t of ALWAYS_STRIP_TABLES) {
        expect(keepSet.has(t)).toBe(false)
      }
    })
  })

  describe('IMPORT_ORDER', () => {
    it('has PREFERENCES first', () => {
      expect(IMPORT_ORDER[0]).toBe(BackupDomain.PREFERENCES)
    })

    it('has TOPICS before KNOWLEDGE (FK dependency)', () => {
      const topicsIdx = IMPORT_ORDER.indexOf(BackupDomain.TOPICS)
      const knowledgeIdx = IMPORT_ORDER.indexOf(BackupDomain.KNOWLEDGE)
      expect(topicsIdx).toBeLessThan(knowledgeIdx)
    })

    it('covers all BackupDomain values', () => {
      const allDomains = new Set(Object.values(BackupDomain))
      const ordered = new Set(IMPORT_ORDER)
      for (const d of allDomains) {
        expect(ordered.has(d)).toBe(true)
      }
    })

    it('has PROVIDERS before ASSISTANTS', () => {
      const providersIdx = IMPORT_ORDER.indexOf(BackupDomain.PROVIDERS)
      const assistantsIdx = IMPORT_ORDER.indexOf(BackupDomain.ASSISTANTS)
      expect(providersIdx).toBeLessThan(assistantsIdx)
    })

    it('has MCP_SERVERS before ASSISTANTS', () => {
      const mcpIdx = IMPORT_ORDER.indexOf(BackupDomain.MCP_SERVERS)
      const assistantsIdx = IMPORT_ORDER.indexOf(BackupDomain.ASSISTANTS)
      expect(mcpIdx).toBeLessThan(assistantsIdx)
    })
  })
})
