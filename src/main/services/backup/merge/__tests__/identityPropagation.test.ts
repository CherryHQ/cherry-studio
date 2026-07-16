import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import type { IdentityMap } from '@main/services/backup/merge'
import { describe, expect, it } from 'vitest'

import { propagateIdentityReferences } from '../identityPropagation'

const createIdentityMap = (): IdentityMap => ({
  sourceMap: new Map(),
  targetMap: new Map([
    ['agent_workspace', new Map([['workspace-backup', 'workspace-local']])],
    ['tag', new Map([['tag-backup', 'tag-local']])],
    ['job_schedule', new Map([['schedule-backup', 'schedule-local']])],
    ['translate_language', new Map([['language-backup', 'language-local']])],
    ['agent_global_skill', new Map([['skill-backup', 'skill-local']])]
  ])
})

describe('propagateIdentityReferences', () => {
  const registry = contributorManager.getRegistry()

  it('rewrites every natural-key target before a source row is written', () => {
    const identityMap = createIdentityMap()
    const channelWorkspace = JSON.stringify({ type: 'user', workspaceId: 'workspace-backup' })
    const scheduleTemplate = JSON.stringify({ workspace: { type: 'user', workspaceId: 'workspace-backup' } })

    const session = propagateIdentityReferences(
      registry,
      'agent_session',
      { workspace_id: 'workspace-backup' },
      identityMap
    )
    const channel = propagateIdentityReferences(registry, 'agent_channel', { workspace: channelWorkspace }, identityMap)
    const schedule = propagateIdentityReferences(
      registry,
      'job_schedule',
      { job_input_template: scheduleTemplate },
      identityMap
    )
    const entityTag = propagateIdentityReferences(registry, 'entity_tag', { tag_id: 'tag-backup' }, identityMap)
    const channelTask = propagateIdentityReferences(
      registry,
      'agent_channel_task',
      { task_id: 'schedule-backup' },
      identityMap
    )
    const history = propagateIdentityReferences(
      registry,
      'translate_history',
      { source_language: 'language-backup', target_language: 'language-backup' },
      identityMap
    )
    const agentSkill = propagateIdentityReferences(registry, 'agent_skill', { skill_id: 'skill-backup' }, identityMap)

    expect(session).toEqual({ workspace_id: 'workspace-local' })
    expect(JSON.parse(String(channel.workspace))).toEqual({ type: 'user', workspaceId: 'workspace-local' })
    expect(JSON.parse(String(schedule.job_input_template))).toEqual({
      workspace: { type: 'user', workspaceId: 'workspace-local' }
    })
    expect(entityTag).toEqual({ tag_id: 'tag-local' })
    expect(channelTask).toEqual({ task_id: 'schedule-local' })
    expect(history).toEqual({ source_language: 'language-local', target_language: 'language-local' })
    expect(agentSkill).toEqual({ skill_id: 'skill-local' })
    expect(channelWorkspace).toBe(JSON.stringify({ type: 'user', workspaceId: 'workspace-backup' }))
  })
})
