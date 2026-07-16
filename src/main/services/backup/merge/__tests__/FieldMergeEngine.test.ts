import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { MergeContext } from '..'
import { MergeEngine } from '..'

describe('MergeEngine FIELD_MERGE integration', () => {
  const dbh = setupTestDatabase()
  const registry = contributorManager.getRegistry()
  let backupPath: string
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cs-field-merge-'))
    backupPath = join(tmpDir, 'backup.sqlite')
    await dbh.sqlite.backup(backupPath)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  const seedBackup = (seed: (db: Database.Database) => void): void => {
    const db = new Database(backupPath)
    try {
      db.pragma('foreign_keys = ON')
      db.transaction(seed)(db)
    } finally {
      db.close()
    }
  }

  const runMerge = (
    domains: readonly MergeContext['domains'][number][],
    userStrategy?: MergeContext['userStrategy']
  ): Promise<unknown> =>
    new MergeEngine(registry, { backupDbPath: backupPath }).mergeBackupIntoWork(dbh.sqlite, dbh.db, {
      domains,
      userStrategy,
      skippedFileEntryIds: new Set<string>()
    })

  const now = (): number => Date.now()

  const insertProvider = (db: Database.Database, apiKeys: string, authConfig: string, name: string): void => {
    const timestamp = now()
    db.prepare(
      `INSERT INTO user_provider (provider_id, name, api_keys, auth_config, is_enabled, order_key, created_at, updated_at)
       VALUES ('provider-id', ?, ?, ?, 0, 'provider-order', ?, ?)`
    ).run(name, apiKeys, authConfig, timestamp, timestamp)
  }

  const insertProviderModel = (db: Database.Database, id: string, modelId: string): void => {
    const timestamp = now()
    db.prepare(
      `INSERT INTO user_model (
        id, provider_id, model_id, name, capabilities, supports_streaming,
        is_enabled, is_hidden, is_deprecated, order_key, created_at, updated_at
      ) VALUES (?, 'provider-id', ?, 'Backup model', '[]', 1, 1, 0, 0, 'model-order', ?, ?)`
    ).run(id, modelId, timestamp, timestamp)
  }

  const insertSkill = (db: Database.Database, id: string, description: string | null): void => {
    const timestamp = now()
    db.prepare(
      `INSERT INTO agent_global_skill (id, name, description, folder_name, source, content_hash, is_enabled, created_at, updated_at)
       VALUES (?, 'skill', ?, 'skill-folder', 'local', 'hash', 0, ?, ?)`
    ).run(id, description, timestamp, timestamp)
  }

  const insertTag = (db: Database.Database, id: string, color: string | null): void => {
    const timestamp = now()
    db.prepare(`INSERT INTO tag (id, name, color, created_at, updated_at) VALUES (?, 'shared-tag', ?, ?, ?)`).run(
      id,
      color,
      timestamp,
      timestamp
    )
  }

  const insertMiniApp = (db: Database.Database, configuration: string): void => {
    const timestamp = now()
    db.prepare(
      `INSERT INTO mini_app (app_id, name, url, status, order_key, bordered, configuration, created_at, updated_at)
       VALUES ('mini-app', 'mini', 'https://example.test', 'enabled', 'mini-order', 1, ?, ?, ?)`
    ).run(configuration, timestamp, timestamp)
  }

  const insertWorkspace = (db: Database.Database, id: string, name: string): void => {
    const timestamp = now()
    db.prepare(
      `INSERT INTO agent_workspace (id, name, path, type, order_key, created_at, updated_at)
       VALUES (?, ?, '/workspace/shared', 'user', 'workspace-order', ?, ?)`
    ).run(id, name, timestamp, timestamp)
  }

  const insertSchedule = (db: Database.Database, id: string, template: string): void => {
    const timestamp = now()
    db.prepare(
      `INSERT INTO job_schedule (id, type, name, trigger, job_input_template, enabled, catch_up_policy, metadata, created_at, updated_at)
       VALUES (?, 'agent.task', 'shared-task', '{}', ?, 1, '{}', '{}', ?, ?)`
    ).run(id, template, timestamp, timestamp)
  }

  it('fills seeded provider credentials while preserving populated local provider fields', async () => {
    insertProvider(dbh.sqlite, '[]', JSON.stringify({ type: 'api-key' }), 'local provider')
    seedBackup((db) =>
      insertProvider(
        db,
        JSON.stringify([{ key: 'backup-key' }]),
        JSON.stringify({ type: 'oauth', refreshToken: 'token' }),
        'backup provider'
      )
    )

    await runMerge(['PROVIDERS'])

    const merged = dbh.sqlite
      .prepare(`SELECT name, api_keys, auth_config FROM user_provider WHERE provider_id = 'provider-id'`)
      .get() as { name: string; api_keys: string; auth_config: string }
    expect(merged.name).toBe('local provider')
    expect(JSON.parse(merged.api_keys)).toEqual([{ key: 'backup-key' }])
    expect(JSON.parse(merged.auth_config)).toEqual({ type: 'oauth', refreshToken: 'token' })
  })

  it('imports backup-only provider members after a provider field merge and remains idempotent', async () => {
    insertProvider(dbh.sqlite, '[]', JSON.stringify({ type: 'api-key' }), 'local provider')
    seedBackup((db) => {
      insertProvider(
        db,
        JSON.stringify([{ key: 'backup-key' }]),
        JSON.stringify({ type: 'api-key' }),
        'backup provider'
      )
      insertProviderModel(db, 'provider-id::backup-model', 'backup-model')
    })

    await runMerge(['PROVIDERS'])

    expect(
      dbh.sqlite
        .prepare(`SELECT id, provider_id, model_id FROM user_model WHERE id = 'provider-id::backup-model'`)
        .get()
    ).toEqual({ id: 'provider-id::backup-model', provider_id: 'provider-id', model_id: 'backup-model' })

    await runMerge(['PROVIDERS'])
    expect((dbh.sqlite.prepare(`SELECT COUNT(*) AS count FROM user_model`).get() as { count: number }).count).toBe(1)
  })

  it('merges a skill by folderName onto the local UUID canonical row', async () => {
    insertSkill(dbh.sqlite, 'skill-local', null)
    seedBackup((db) => insertSkill(db, 'skill-backup', 'backup description'))

    await runMerge(['SKILLS'])

    const rows = dbh.sqlite
      .prepare(`SELECT id, description FROM agent_global_skill WHERE folder_name = 'skill-folder'`)
      .all() as {
      id: string
      description: string | null
    }[]
    expect(rows).toEqual([{ id: 'skill-local', description: 'backup description' }])
  })

  it('merges a tag by name and propagates the local canonical tag ID to entity_tag', async () => {
    insertTag(dbh.sqlite, 'tag-local', null)
    seedBackup((db) => {
      insertTag(db, 'tag-backup', '#123456')
      const timestamp = now()
      db.prepare(
        `INSERT INTO entity_tag (entity_type, entity_id, tag_id, created_at, updated_at)
         VALUES ('topic', 'topic-backup', 'tag-backup', ?, ?)`
      ).run(timestamp, timestamp)
    })

    await runMerge(['TAGS_GROUPS'])

    const tag = dbh.sqlite.prepare(`SELECT id, color FROM tag WHERE name = 'shared-tag'`).get() as {
      id: string
      color: string
    }
    const entityTag = dbh.sqlite.prepare(`SELECT tag_id FROM entity_tag WHERE entity_id = 'topic-backup'`).get() as {
      tag_id: string
    }
    expect(tag).toEqual({ id: 'tag-local', color: '#123456' })
    expect(entityTag.tag_id).toBe('tag-local')
  })

  it('does not import entity_tag rows for an explicitly skipped tag source', async () => {
    insertTag(dbh.sqlite, 'tag-local', null)
    seedBackup((db) => {
      insertTag(db, 'tag-backup', '#123456')
      const timestamp = now()
      db.prepare(
        `INSERT INTO entity_tag (entity_type, entity_id, tag_id, created_at, updated_at)
         VALUES ('topic', 'topic-backup', 'tag-backup', ?, ?)`
      ).run(timestamp, timestamp)
    })

    await runMerge(['TAGS_GROUPS'], 'SKIP')

    expect((dbh.sqlite.prepare(`SELECT COUNT(*) AS count FROM entity_tag`).get() as { count: number }).count).toBe(0)
  })

  it('deep-merges miniapp configuration without overwriting a local JSON leaf', async () => {
    insertMiniApp(dbh.sqlite, JSON.stringify({ local: true, shared: { value: 'local' } }))
    seedBackup((db) => insertMiniApp(db, JSON.stringify({ remote: true, shared: { value: 'backup', added: 1 } })))

    await runMerge(['MINIAPPS'])

    const row = dbh.sqlite.prepare(`SELECT configuration FROM mini_app WHERE app_id = 'mini-app'`).get() as {
      configuration: string
    }
    expect(JSON.parse(row.configuration)).toEqual({ local: true, remote: true, shared: { value: 'local', added: 1 } })
  })

  it('pre-registers canonical IDs before inserts and rewrites AGENTS FK, JSON, and junction rows', async () => {
    insertWorkspace(dbh.sqlite, 'workspace-local', 'local workspace')
    insertSchedule(
      dbh.sqlite,
      'schedule-local',
      JSON.stringify({ workspace: { type: 'user', workspaceId: 'workspace-local' }, local: true })
    )
    insertSkill(dbh.sqlite, 'skill-local', null)

    seedBackup((db) => {
      insertWorkspace(db, 'workspace-backup', 'backup workspace')
      insertSchedule(
        db,
        'schedule-backup',
        JSON.stringify({ workspace: { type: 'user', workspaceId: 'workspace-backup' }, remote: true })
      )
      insertSkill(db, 'skill-backup', 'backup skill description')
      const timestamp = now()
      db.prepare(
        `INSERT INTO agent (id, type, name, description, instructions, disabled_tools, configuration, order_key, created_at, updated_at)
         VALUES ('agent-backup', 'custom', 'agent', '', 'instructions', '[]', '{}', 'agent-order', ?, ?)`
      ).run(timestamp, timestamp)
      db.prepare(
        `INSERT INTO agent_session (id, name, is_name_manually_edited, description, workspace_id, order_key, created_at, updated_at)
         VALUES ('session-backup', 'session', 0, '', 'workspace-backup', 'session-order', ?, ?)`
      ).run(timestamp, timestamp)
      db.prepare(
        `INSERT INTO agent_channel (id, type, name, session_id, workspace, config, is_active, active_chat_ids, created_at, updated_at)
         VALUES ('channel-backup', 'telegram', 'channel', 'session-backup', ?, '{}', 1, '[]', ?, ?)`
      ).run(JSON.stringify({ type: 'user', workspaceId: 'workspace-backup' }), timestamp, timestamp)
      db.prepare(
        `INSERT INTO agent_channel_task (channel_id, task_id) VALUES ('channel-backup', 'schedule-backup')`
      ).run()
      db.prepare(
        `INSERT INTO agent_skill (agent_id, skill_id, is_enabled, created_at, updated_at)
         VALUES ('agent-backup', 'skill-backup', 1, ?, ?)`
      ).run(timestamp, timestamp)
    })

    await runMerge(['AGENTS', 'SKILLS'])

    const session = dbh.sqlite.prepare(`SELECT workspace_id FROM agent_session WHERE id = 'session-backup'`).get() as {
      workspace_id: string
    }
    const channel = dbh.sqlite.prepare(`SELECT workspace FROM agent_channel WHERE id = 'channel-backup'`).get() as {
      workspace: string
    }
    const schedule = dbh.sqlite
      .prepare(`SELECT job_input_template FROM job_schedule WHERE id = 'schedule-local'`)
      .get() as {
      job_input_template: string
    }
    const channelTask = dbh.sqlite
      .prepare(`SELECT task_id FROM agent_channel_task WHERE channel_id = 'channel-backup'`)
      .get() as {
      task_id: string
    }
    const agentSkill = dbh.sqlite.prepare(`SELECT skill_id FROM agent_skill WHERE agent_id = 'agent-backup'`).get() as {
      skill_id: string
    }

    expect(session.workspace_id).toBe('workspace-local')
    expect(JSON.parse(channel.workspace)).toEqual({ type: 'user', workspaceId: 'workspace-local' })
    expect(JSON.parse(schedule.job_input_template)).toEqual({
      workspace: { type: 'user', workspaceId: 'workspace-local' },
      local: true,
      remote: true
    })
    expect(channelTask.task_id).toBe('schedule-local')
    expect(agentSkill.skill_id).toBe('skill-local')
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    expect(dbh.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')

    const rowsBeforeRerun = (
      dbh.sqlite.prepare(`SELECT COUNT(*) AS count FROM agent_channel_task`).get() as { count: number }
    ).count
    await runMerge(['AGENTS', 'SKILLS'])
    const rowsAfterRerun = (
      dbh.sqlite.prepare(`SELECT COUNT(*) AS count FROM agent_channel_task`).get() as { count: number }
    ).count
    expect(rowsAfterRerun).toBe(rowsBeforeRerun)
  })
})
