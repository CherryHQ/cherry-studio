import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { artifactService } from '@data/services/ArtifactService'

import { createCherryToolsServer } from '../cherryBuiltinTools'
import { callBuiltinTool, toolText } from './builtinMcpClient'

describe('report_artifacts indexes the Agent outputs', () => {
  const dbh = setupTestDatabase()
  let workspacePath: string
  let sessionId: string

  function createServer() {
    return createCherryToolsServer({
      agentId: 'reporter',
      agentDataPath: workspacePath,
      sessionId,
      workspaceSource: { type: 'system' },
      workspacePath,
      trustedNotifyChannels: [],
      allowAnyOwnedNotifyChannel: false,
      getKnowledgeAccess: () => ({ allKnowledgeBases: false, baseIds: [] })
    })
  }

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(os.tmpdir(), 'cherry-report-artifacts-'))
    dbh.db
      .insert(agentTable)
      .values({ id: 'reporter', type: 'claude-code', name: 'Reporter', instructions: '', orderKey: 'a' })
      .run()
    const workspace = agentWorkspaceService.findOrCreateByPath(workspacePath)
    sessionId = agentSessionService.create({
      agentId: 'reporter',
      name: 'Weekly review',
      workspace: { type: 'user', workspaceId: workspace.id }
    }).id
  })

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true })
  })

  it('records each reported file with its absolute path, title, kind and size', async () => {
    await mkdir(path.join(workspacePath, 'out'))
    await writeFile(path.join(workspacePath, 'out', 'report.html'), '<h1>Report</h1>')
    await writeFile(path.join(workspacePath, 'chart.png'), Buffer.alloc(2048))

    const result = await callBuiltinTool(createServer, 'report_artifacts', {
      artifacts: [
        { path: 'out/report.html', description: 'Weekly report' },
        { path: path.join(workspacePath, 'chart.png') },
        { path: 'missing.csv' }
      ]
    })

    expect(result.isError, toolText(result)).not.toBe(true)
    const byTitle = Object.fromEntries(
      artifactService.list({ agentId: 'reporter' }).items.map((item) => [item.title, item])
    )
    expect(byTitle['Weekly report']).toMatchObject({
      path: path.join(workspacePath, 'out', 'report.html'),
      kind: 'page',
      size: 15,
      sourceId: sessionId,
      sourceName: 'Weekly review'
    })
    expect(byTitle['chart.png']).toMatchObject({ kind: 'media', size: 2048 })
    // A deliverable that is not on disk is still listed; the pane shows it as unavailable.
    expect(byTitle['missing.csv']).toMatchObject({ kind: 'file', size: undefined })
  })

  it('still confirms the report when the outputs cannot be indexed', async () => {
    sessionId = 'session-without-row'

    const result = await callBuiltinTool(createServer, 'report_artifacts', { artifacts: [{ path: 'a.md' }] })

    expect(result.isError, toolText(result)).not.toBe(true)
    expect(toolText(result)).toContain('Recorded 1 artifact')
  })
})
