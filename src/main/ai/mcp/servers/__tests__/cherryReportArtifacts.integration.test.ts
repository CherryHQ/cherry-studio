import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { artifactService } from '@data/services/ArtifactService'

import { createCherryToolsServer } from '../cherryBuiltinTools'
import { backfillPastOutputs } from '../cherryReportArtifacts'
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
    vi.restoreAllMocks()
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

  describe('past reports', () => {
    function pastReport(artifacts: { path: string; description?: string }[]) {
      dbh.db
        .insert(agentSessionMessageTable)
        .values({
          sessionId,
          role: 'assistant',
          status: 'success',
          data: {
            parts: [
              {
                type: 'dynamic-tool',
                toolName: 'mcp__cherry-tools__report_artifacts',
                toolCallId: 'call-1',
                state: 'output-available',
                input: { artifacts },
                output: { content: 'Recorded' }
              }
            ]
          } as never
        })
        .run()
    }

    it('indexes deliverables reported before outputs were indexed, sized from the files still on disk', async () => {
      await writeFile(path.join(workspacePath, 'summary.md'), '# Summary')
      pastReport([{ path: 'summary.md', description: 'Summary' }, { path: 'deleted.pdf' }])

      await backfillPastOutputs()

      const byTitle = Object.fromEntries(
        artifactService.list({ agentId: 'reporter' }).items.map((item) => [item.title, item])
      )
      expect(byTitle.Summary).toMatchObject({ path: path.join(workspacePath, 'summary.md'), kind: 'page', size: 9 })
      expect(byTitle['deleted.pdf']).toMatchObject({ kind: 'file', size: undefined })
    })

    it('leaves the Outputs list working when the backfill fails, and retries on the next start', async () => {
      pastReport([{ path: 'old.md' }])
      await callBuiltinTool(createServer, 'report_artifacts', { artifacts: [{ path: 'new.md' }] })
      vi.spyOn(artifactService, 'findPastAgentReports').mockImplementationOnce(() => {
        throw new Error('corrupt history')
      })

      await expect(backfillPastOutputs()).resolves.toBeUndefined()
      expect(artifactService.list({ agentId: 'reporter' }).items.map((item) => item.title)).toEqual(['new.md'])

      await backfillPastOutputs()
      expect(
        artifactService
          .list({ agentId: 'reporter' })
          .items.map((item) => item.title)
          .sort()
      ).toEqual(['new.md', 'old.md'])
    })
  })
})
