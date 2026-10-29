import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { application } from '@application'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import { agentTable } from '../../schemas/agent'
import { agentSessionTable } from '../../schemas/agentSession'
import { agentSessionMessageTable } from '../../schemas/agentSessionMessage'
import { agentWorkspaceTable } from '../../schemas/agentWorkspace'
import { assistantTable } from '../../schemas/assistant'
import { fileEntryTable } from '../../schemas/file'
import { groupTable } from '../../schemas/group'
import { messageTable } from '../../schemas/message'
import { preferenceTable } from '../../schemas/preference'
import { promptBindingTable, promptTable } from '../../schemas/prompt'
import { topicTable } from '../../schemas/topic'
import { translateHistoryTable } from '../../schemas/translateHistory'
import { translateLanguageTable } from '../../schemas/translateLanguage'
import { userModelTable } from '../../schemas/userModel'
import { userProviderTable } from '../../schemas/userProvider'
import {
  applyConfigurationTx,
  captureConfiguration,
  CONFIGURATION_PREFERENCE_KEYS,
  type ConfigurationPayload,
  validateConfigurationPayload
} from '../configurationBackup'

describe('configuration backup projection and merge', () => {
  const dbh = setupTestDatabase()
  const excluded = [
    'topic',
    'message',
    'agent_session',
    'agent_session_message',
    'job',
    'file_entry',
    'pin',
    'tag',
    'entity_tag',
    'knowledge_item',
    'translate_history',
    'browser_visit',
    'ai_usage_record'
  ]
  const snapshot = () =>
    Object.fromEntries(
      (
        dbh.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
          name: string
        }[]
      ).map(({ name }) => [name, dbh.sqlite.prepare(`SELECT * FROM "${name}"`).all()])
    )
  const apply = (payload: ConfigurationPayload) =>
    application.get('DbService').withWriteTx((tx) => applyConfigurationTx(tx, payload))

  function seed() {
    dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'provider', name: 'Source provider', orderKey: 'a0', createdAt: 10, updatedAt: 20 })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'provider::model',
        providerId: 'provider',
        modelId: 'model',
        name: 'Model',
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'a0',
        createdAt: 10,
        updatedAt: 20
      })
      .run()
    dbh.db
      .insert(groupTable)
      .values({
        id: 'group',
        entityType: 'assistant',
        name: 'Source group',
        orderKey: 'a1',
        createdAt: 10,
        updatedAt: 20
      })
      .run()
    dbh.db
      .insert(assistantTable)
      .values({
        id: 'assistant',
        name: 'Source assistant',
        emoji: '🌟',
        modelId: 'provider::model',
        groupId: 'group',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a1',
        createdAt: 10,
        updatedAt: 20,
        deletedAt: 30
      })
      .run()
    dbh.db
      .insert(agentTable)
      .values({
        id: 'agent',
        type: 'claude-code',
        name: 'Source agent',
        instructions: 'Definition',
        model: 'provider::model',
        configuration: {
          avatar: '🌟',
          permission_mode: 'plan',
          env_vars: { SOURCE: 'yes' },
          slash_commands: ['private'],
          bootstrap_completed: true,
          scheduler_enabled: true,
          scheduler_cron: 'secret',
          heartbeat_enabled: true,
          heartbeat_interval: 5,
          builtin_role: 'doctor',
          unknown: 'private'
        },
        orderKey: 'a1',
        createdAt: 10,
        updatedAt: 20,
        deletedAt: 30
      })
      .run()
    dbh.db
      .insert(promptTable)
      .values({
        id: 'prompt',
        title: 'Reusable',
        content: 'Source snippet',
        visibility: 'restricted',
        orderKey: 'a1',
        createdAt: 10,
        updatedAt: 20
      })
      .run()
    dbh.db
      .insert(promptBindingTable)
      .values({
        promptId: 'prompt',
        targetType: 'agent',
        targetId: 'agent',
        orderKey: 'a1',
        createdAt: 10,
        updatedAt: 20
      })
      .run()
    dbh.db
      .insert(translateLanguageTable)
      .values({ langCode: 'custom', value: 'Custom language', emoji: '🌐', createdAt: 10, updatedAt: 20 })
      .run()
    return captureConfiguration(dbh.db, 'global')
  }

  function seedHistory() {
    dbh.db
      .insert(topicTable)
      .values({ id: 'topic', name: 'historysentinel', assistantId: 'assistant', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(messageTable)
      .values({
        id: 'root',
        topicId: 'topic',
        role: 'root',
        data: { parts: [] },
        status: 'success',
        modelId: 'provider::model'
      })
      .run()
    dbh.db
      .insert(messageTable)
      .values({
        id: 'message',
        parentId: 'root',
        topicId: 'topic',
        role: 'user',
        data: { parts: [{ type: 'text', text: 'historysentinel message' }] },
        status: 'success',
        modelId: 'provider::model',
        compactionSummary: 'historysentinel summary'
      })
      .run()
    dbh.db.insert(agentWorkspaceTable).values({ id: 'workspace', name: 'Local', path: '/local', orderKey: 'a0' }).run()
    dbh.db
      .insert(agentSessionTable)
      .values({
        id: 'session',
        agentId: 'agent',
        workspaceId: 'workspace',
        name: 'historysentinel session',
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: 'agent-message',
        sessionId: 'session',
        role: 'user',
        data: { parts: [{ type: 'text', text: 'historysentinel agent' }] },
        status: 'success',
        modelId: 'provider::model'
      })
      .run()
    dbh.db
      .insert(fileEntryTable)
      .values({ id: 'attachment', origin: 'internal', name: 'historysentinel attachment', size: 10 })
      .run()
    dbh.db
      .insert(translateHistoryTable)
      .values({
        id: 'translation',
        sourceText: 'historysentinel source',
        targetText: 'historysentinel target',
        sourceLanguage: 'custom'
      })
      .run()
  }

  it('materializes every supported preference, preserving explicit null, false, empty and nested values through restore', () => {
    const values = {
      'chat.code.fancy_block': null,
      'chat.code.collapsible': false,
      'chat.code.editor.theme_dark': '',
      'chat.input.toolbar.pinned_tools': [],
      'chat.input.send_message_shortcut': { key: 'Enter', modifiers: { ctrl: true }, alternatives: [] }
    }
    for (const [key, value] of Object.entries(values)) dbh.db.insert(preferenceTable).values({ key, value }).run()
    for (const key of [
      'ui.sidebar_shortcut',
      'ui.sidebar.favorites',
      'chat.save.knowledge.last_base_id',
      'target.unknown'
    ]) {
      dbh.db.insert(preferenceTable).values({ key, value: 'local-only' }).run()
    }
    const payload = captureConfiguration(dbh.db, 'global')
    const exported = Object.fromEntries(payload.tables.preference.map(({ key, value }) => [key, value]))
    expect(Object.keys(exported).sort()).toEqual(
      Object.keys(DefaultPreferences.default)
        .filter(
          (key) => !['ui.sidebar_shortcut', 'ui.sidebar.favorites', 'chat.save.knowledge.last_base_id'].includes(key)
        )
        .sort()
    )
    expect(exported).toMatchObject(values)
    expect(exported['chat.code.editor.enabled']).toBe(DefaultPreferences.default['chat.code.editor.enabled'])
    expect(payload.tables.preference.every((row) => Object.keys(row).sort().join(',') === 'key,scope,value')).toBe(true)
    dbh.db.delete(preferenceTable).where(eq(preferenceTable.key, 'chat.code.fancy_block')).run()
    dbh.db
      .update(preferenceTable)
      .set({ value: { targetOnlyNested: true }, createdAt: 77 })
      .where(eq(preferenceTable.key, 'chat.input.send_message_shortcut'))
      .run()
    apply(payload)
    const restored = Object.fromEntries(
      dbh.db
        .select()
        .from(preferenceTable)
        .all()
        .map(({ key, value }) => [key, value])
    )
    expect(restored).toMatchObject(exported)
    expect(restored['target.unknown']).toBe('local-only')
    expect(restored['ui.sidebar_shortcut']).toBe('local-only')
    expect(
      dbh.db.select().from(preferenceTable).where(eq(preferenceTable.key, 'chat.input.send_message_shortcut')).get()
        ?.createdAt
    ).toBe(77)
  })

  it('drops all operational agent keys and non-assistant groups at capture', () => {
    seed()
    dbh.db
      .insert(groupTable)
      .values({ id: 'session-group', entityType: 'session', name: 'Private', orderKey: 'a0' })
      .run()
    const payload = captureConfiguration(dbh.db, 'global')
    expect(payload.tables.agent[0].configuration).toEqual({
      avatar: '🌟',
      permission_mode: 'plan',
      env_vars: { SOURCE: 'yes' }
    })
    expect(payload.tables.group.map(({ id }) => id)).toEqual(['group'])
    expect(
      payload.tables.preference.some(({ key }) =>
        ['ui.sidebar_shortcut', 'ui.sidebar.favorites', 'chat.save.knowledge.last_base_id'].includes(key)
      )
    ).toBe(false)
  })

  it('merges colliding definitions, preserves local status/setup and target-only rows, and imports new status', () => {
    const payload = seed()
    dbh.db.update(userProviderTable).set({ name: 'Target', createdAt: 77 }).run()
    dbh.db.update(userModelTable).set({ name: 'Target model', createdAt: 77 }).run()
    dbh.db.insert(userProviderTable).values({ providerId: 'local', name: 'Local provider', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({ id: 'local::local', providerId: 'local', modelId: 'local', presetModelId: 'preset', orderKey: 'a0' })
      .run()
    dbh.db.update(assistantTable).set({ name: 'Target', createdAt: 77, deletedAt: null }).run()
    dbh.db
      .update(agentTable)
      .set({
        name: 'Target',
        createdAt: 77,
        deletedAt: null,
        configuration: {
          avatar: 'old',
          language: 'en-US',
          env_vars: { LOCAL: 'no' },
          builtin_role: 'support',
          scheduler_enabled: true,
          heartbeat_enabled: true,
          privateExtension: 123
        }
      })
      .run()
    dbh.db
      .insert(agentTable)
      .values({ id: 'local-agent', type: 'pi', name: 'Local', instructions: '', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(promptBindingTable)
      .values({ promptId: 'prompt', targetType: 'agent', targetId: 'local-agent', orderKey: 'a0' })
      .run()
    dbh.db.update(groupTable).set({ name: 'Target group', orderKey: 'a0', createdAt: 77 }).run()
    dbh.db.update(promptTable).set({ content: 'Target snippet', orderKey: 'a0', createdAt: 77 }).run()
    dbh.db.update(promptBindingTable).set({ orderKey: 'a0', createdAt: 77 }).run()
    dbh.db.update(translateLanguageTable).set({ value: 'Target language', createdAt: 77 }).run()
    payload.tables.agent.push({ ...payload.tables.agent[0], id: 'new-agent' })
    payload.tables.assistant.push({ ...payload.tables.assistant[0], id: 'new-assistant' })
    apply(payload)
    expect(
      dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'provider')).get()
    ).toMatchObject({ name: 'Source provider', createdAt: 77, updatedAt: 20 })
    expect(dbh.db.select().from(userModelTable).where(eq(userModelTable.id, 'provider::model')).get()).toMatchObject({
      name: 'Model',
      createdAt: 77
    })
    expect(dbh.db.select().from(userModelTable).all()).toHaveLength(2)
    expect(dbh.db.select().from(assistantTable).get()).toMatchObject({
      name: 'Source assistant',
      createdAt: 77,
      deletedAt: null
    })
    expect(dbh.db.select().from(assistantTable).where(eq(assistantTable.id, 'new-assistant')).get()).toMatchObject({
      createdAt: 10,
      deletedAt: 30
    })
    expect(dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent')).get()).toMatchObject({
      name: 'Source agent',
      createdAt: 77,
      deletedAt: null,
      configuration: {
        avatar: '🌟',
        permission_mode: 'plan',
        env_vars: { SOURCE: 'yes' },
        builtin_role: 'support',
        scheduler_enabled: true,
        heartbeat_enabled: true,
        privateExtension: 123
      }
    })
    expect(dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent')).get()?.configuration).not.toHaveProperty(
      'language'
    )
    expect(dbh.db.select().from(agentTable).where(eq(agentTable.id, 'new-agent')).get()).toMatchObject({
      createdAt: 10,
      deletedAt: 30,
      configuration: { avatar: '🌟' }
    })
    expect(
      dbh.db.select().from(agentTable).where(eq(agentTable.id, 'new-agent')).get()?.configuration
    ).not.toHaveProperty('builtin_role')
    expect(dbh.db.select().from(promptBindingTable).all()).toHaveLength(2)
    expect(
      dbh.db.select().from(promptBindingTable).where(eq(promptBindingTable.targetId, 'agent')).get()
    ).toMatchObject({ orderKey: 'a1', createdAt: 77, updatedAt: 20 })
    expect(dbh.db.select().from(promptTable).get()).toMatchObject({
      content: 'Source snippet',
      orderKey: 'a1',
      createdAt: 77
    })
    expect(dbh.db.select().from(groupTable).get()).toMatchObject({
      name: 'Source group',
      orderKey: 'a1',
      createdAt: 77
    })
    expect(dbh.db.select().from(translateLanguageTable).get()).toMatchObject({
      value: 'Custom language',
      createdAt: 77
    })
  })

  it('round-trips all six agent configuration fields and replaces credential arrays and nested provider settings as whole values', () => {
    seed()
    const configuration = {
      avatar: '🌟',
      permission_mode: 'auto',
      reasoning_effort: 'high',
      service_tier: 'flex',
      env_vars: { SOURCE: 'value' },
      language: ' English '
    }
    const apiKeys = [
      { id: 'key1', key: 'fixture-key', isEnabled: true },
      { id: 'key2', key: 'fixture-key2', isEnabled: false, label: '' }
    ]
    const providerSettings = { extraHeaders: { 'x-source': 'value' }, rateLimit: 0 }
    dbh.db
      .update(agentTable)
      .set({ configuration: { ...configuration, heartbeat_enabled: true } })
      .run()
    dbh.db.update(userProviderTable).set({ apiKeys, providerSettings }).run()
    const payload = captureConfiguration(dbh.db, 'global')
    expect(payload.tables.agent[0].configuration).toEqual(configuration)
    dbh.db.update(agentTable).set({ configuration: {} }).run()
    dbh.db
      .update(userProviderTable)
      .set({
        apiKeys: [{ id: 'local', key: 'local-fixture-key', isEnabled: true }],
        providerSettings: { extraHeaders: { 'x-local': 'remove' } }
      })
      .run()
    apply(payload)
    expect(dbh.db.select().from(agentTable).get()?.configuration).toEqual(configuration)
    expect(dbh.db.select().from(userProviderTable).get()).toMatchObject({ apiKeys, providerSettings })
    expect(dbh.db.select().from(userProviderTable).get()?.providerSettings?.extraHeaders).toEqual({
      'x-source': 'value'
    })
  })

  it.each(['agent', 'group'] as const)('rejects %s runtime/entity collisions before any write', (section) => {
    const payload = seed()
    if (section === 'agent') dbh.db.update(agentTable).set({ type: 'pi' }).run()
    else dbh.db.update(groupTable).set({ entityType: 'session' }).run()
    const before = snapshot()
    expect(() => apply(payload)).toThrow('BACKUP_CONFIGURATION_CONFLICT')
    expect(snapshot()).toEqual(before)
  })

  it('performs no insert/update/delete on excluded tables or history FTS, including FK cascades', () => {
    const payload = seed()
    seedHistory()
    const before = snapshot()
    const search = () =>
      ['message_fts', 'agent_session_message_fts'].map((name) =>
        dbh.sqlite.prepare(`SELECT rowid, searchable_text FROM ${name} WHERE ${name} MATCH 'historysentinel'`).all()
      )
    const fts = search()
    expect(fts.map((rows) => rows.length)).toEqual([1, 1])
    for (const table of excluded)
      for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
        dbh.sqlite.exec(
          `CREATE TRIGGER guard_${table}_${event} BEFORE ${event} ON "${table}" BEGIN SELECT RAISE(ABORT, 'history write'); END`
        )
      }
    try {
      apply(payload)
      const after = snapshot()
      for (const table of excluded) expect(after[table], table).toEqual(before[table])
      expect(search()).toEqual(fts)
    } finally {
      for (const table of excluded)
        for (const event of ['INSERT', 'UPDATE', 'DELETE']) dbh.sqlite.exec(`DROP TRIGGER guard_${table}_${event}`)
    }
  })

  it('rolls back every earlier upsert when SQL fails in the last preference section', () => {
    const payload = seed()
    seedHistory()
    payload.tables.user_provider[0].name = 'Must roll back'
    const before = snapshot()
    dbh.sqlite.exec(
      "CREATE TRIGGER late_failure BEFORE INSERT ON preference BEGIN SELECT RAISE(ABORT, 'late SQL failure'); END"
    )
    try {
      expect(() => apply(payload)).toThrow()
      expect(snapshot()).toEqual(before)
    } finally {
      dbh.sqlite.exec('DROP TRIGGER late_failure')
    }
  })

  it.each([
    [
      'missing section',
      (p: ConfigurationPayload) => {
        Reflect.deleteProperty(p.tables, 'prompt')
      }
    ],
    [
      'extra field',
      (p: ConfigurationPayload) => {
        Object.assign(p.tables.assistant[0], { history: 'secret' })
      }
    ],
    [
      'duplicate identity',
      (p: ConfigurationPayload) => {
        p.tables.agent.push(p.tables.agent[0])
      }
    ],
    [
      'invalid model identity',
      (p: ConfigurationPayload) => {
        p.tables.user_model[0].id = 'other'
      }
    ],
    [
      'missing reference',
      (p: ConfigurationPayload) => {
        p.tables.assistant[0].groupId = 'missing'
      }
    ],
    [
      'missing preference',
      (p: ConfigurationPayload) => {
        p.tables.preference.pop()
      }
    ],
    [
      'unknown preference',
      (p: ConfigurationPayload) => {
        p.tables.preference[0].key = 'unknown'
      }
    ],
    [
      'duplicate preference',
      (p: ConfigurationPayload) => {
        p.tables.preference.push(p.tables.preference[0])
      }
    ],
    [
      'operational configuration',
      (p: ConfigurationPayload) => {
        Object.assign(p.tables.agent[0].configuration, { scheduler_enabled: true })
      }
    ],
    [
      'invalid enum',
      (p: ConfigurationPayload) => {
        Object.assign(p.tables.agent[0].configuration, { permission_mode: 'invalid' })
      }
    ],
    [
      'nonfinite number',
      (p: ConfigurationPayload) => {
        p.tables.preference[0].value = Infinity
      }
    ]
  ])('rejects %s without altering the database', (_name, mutate) => {
    const payload = seed()
    const before = snapshot()
    mutate(payload)
    expect(() => validateConfigurationPayload(payload)).toThrow('BACKUP_CONFIGURATION_INVALID')
    expect(snapshot()).toEqual(before)
  })

  it('exports a complete preference set even when there are no persisted preference rows', () => {
    expect(captureConfiguration(dbh.db, 'global').tables.preference).toHaveLength(CONFIGURATION_PREFERENCE_KEYS.length)
  })
})
