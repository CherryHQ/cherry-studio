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

    it('covers all BackupDomain values', () => {
      const allDomains = new Set(Object.values(BackupDomain))
      const ordered = new Set(IMPORT_ORDER)
      for (const d of allDomains) {
        expect(ordered.has(d)).toBe(true)
      }
    })

    it('respects all FK dependencies', () => {
      const idx = (d: BackupDomain) => IMPORT_ORDER.indexOf(d)

      // Phase 1 FK chains
      // topic.group_id -> group.id (TAGS_GROUPS)
      expect(idx(BackupDomain.TAGS_GROUPS)).toBeLessThan(idx(BackupDomain.TOPICS))

      // Phase 2 intra-phase FK chains
      // assistant_knowledge_base.knowledge_base_id -> knowledge_base.id
      expect(idx(BackupDomain.KNOWLEDGE)).toBeLessThan(idx(BackupDomain.ASSISTANTS))
      // assistant.model_id -> user_model.id (PROVIDERS)
      expect(idx(BackupDomain.PROVIDERS)).toBeLessThan(idx(BackupDomain.ASSISTANTS))
      // assistant_mcp_server.mcp_server_id -> mcp_server.id
      expect(idx(BackupDomain.MCP_SERVERS)).toBeLessThan(idx(BackupDomain.ASSISTANTS))

      // Cross-phase FKs (TOPICS -> ASSISTANTS, TOPICS -> PROVIDERS, KNOWLEDGE -> PROVIDERS)
      // are handled by DomainStripper SET_NULL at export time, not by IMPORT_ORDER.
      // Phase 1 domains may appear before Phase 2 domains in IMPORT_ORDER;
      // FK references across phases are nullified during selective backup/restore.
    })
  })

  describe('DOMAIN_TABLE_MAP intra-domain ordering', () => {
    it('has translate_language before translate_history (FK: history -> language)', () => {
      const tables = DOMAIN_TABLE_MAP[BackupDomain.TRANSLATE_HISTORY]
      expect(tables.indexOf('translate_language')).toBeLessThan(tables.indexOf('translate_history'))
    })

    it('has topic before message (FK: message.topic_id -> topic.id)', () => {
      const tables = DOMAIN_TABLE_MAP[BackupDomain.TOPICS]
      expect(tables.indexOf('topic')).toBeLessThan(tables.indexOf('message'))
    })

    it('has knowledge_base before knowledge_item (FK: item.base_id -> base.id)', () => {
      const tables = DOMAIN_TABLE_MAP[BackupDomain.KNOWLEDGE]
      expect(tables.indexOf('knowledge_base')).toBeLessThan(tables.indexOf('knowledge_item'))
    })

    it('has assistant before junction tables (FK: junction -> assistant.id)', () => {
      const tables = DOMAIN_TABLE_MAP[BackupDomain.ASSISTANTS]
      expect(tables.indexOf('assistant')).toBeLessThan(tables.indexOf('assistant_mcp_server'))
      expect(tables.indexOf('assistant')).toBeLessThan(tables.indexOf('assistant_knowledge_base'))
    })

    it('has user_provider before user_model (FK: model.provider_id -> provider.provider_id)', () => {
      const tables = DOMAIN_TABLE_MAP[BackupDomain.PROVIDERS]
      expect(tables.indexOf('user_provider')).toBeLessThan(tables.indexOf('user_model'))
    })

    it('has agent parent tables before child tables (FK dependencies)', () => {
      const tables = DOMAIN_TABLE_MAP[BackupDomain.AGENTS]
      const i = (t: string) => tables.indexOf(t)
      expect(i('agent')).toBeLessThan(i('agent_session'))
      expect(i('agent')).toBeLessThan(i('agent_task'))
      expect(i('agent')).toBeLessThan(i('agent_channel'))
      expect(i('agent_global_skill')).toBeLessThan(i('agent_skill'))
      expect(i('agent_channel')).toBeLessThan(i('agent_channel_task'))
      expect(i('agent_task')).toBeLessThan(i('agent_channel_task'))
      expect(i('agent_session')).toBeLessThan(i('agent_session_message'))
      expect(i('agent_task')).toBeLessThan(i('agent_task_run_log'))
    })

    it('has tag before entity_tag (FK: entity_tag.tag_id -> tag.id)', () => {
      const tables = DOMAIN_TABLE_MAP[BackupDomain.TAGS_GROUPS]
      expect(tables.indexOf('tag')).toBeLessThan(tables.indexOf('entity_tag'))
    })

    it('has agent_session before agent_session_message (FK: message.session_id -> session.id)', () => {
      const tables = DOMAIN_TABLE_MAP[BackupDomain.AGENTS]
      expect(tables.indexOf('agent_session')).toBeLessThan(tables.indexOf('agent_session_message'))
    })

    it('has agent_task before agent_task_run_log (FK: run_log.task_id -> task.id)', () => {
      const tables = DOMAIN_TABLE_MAP[BackupDomain.AGENTS]
      expect(tables.indexOf('agent_task')).toBeLessThan(tables.indexOf('agent_task_run_log'))
    })
  })
})
