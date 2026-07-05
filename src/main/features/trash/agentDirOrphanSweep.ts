import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { loggerService } from '@logger'

const logger = loggerService.withContext('AgentDirOrphanSweep')

/**
 * Orphan-directory sweep for the managed agent workspace root
 * (`feature.agents.workspaces` → `{userData}/Data/Agents`). DB rows are the
 * single source of truth (RFC archive §4.2): a direct child directory survives
 * iff it is claimed by the keep-set, everything else is deleted.
 *
 * Keep-set = union of:
 *  - every `agent_workspace.path` row (covers today's per-session workspace
 *    dirs at `root/{sessionId}`; workspace rows survive archive and are only
 *    deleted at session purge), and
 *  - `root/{agent.id}` for EVERY agent row, archived included (protects
 *    per-agent identity/memory dirs created without an agent_workspace row by
 *    the agent root-dir-separation work).
 *
 * Only direct children are inspected — never recurses. Removal failures are
 * logged and left for the next run.
 */
export async function sweepOrphanAgentDirs(): Promise<{ removed: string[] }> {
  const root = application.getPath('feature.agents.workspaces')
  const db = application.get('DbService').getDb()

  const keep = new Set<string>()
  for (const row of db.select({ path: agentWorkspaceTable.path }).from(agentWorkspaceTable).all()) {
    keep.add(path.resolve(row.path))
  }
  for (const row of db.select({ id: agentTable.id }).from(agentTable).all()) {
    keep.add(path.resolve(root, row.id))
  }

  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { removed: [] }
    throw error
  }

  const removed: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dirPath = path.resolve(root, entry.name)
    if (keep.has(dirPath)) continue
    try {
      await fs.rm(dirPath, { recursive: true, force: true })
      removed.push(dirPath)
      logger.info('Removed orphan agent directory', { dirPath })
    } catch (error) {
      logger.warn('Failed to remove orphan agent directory — retried next run', { dirPath, error })
    }
  }
  return { removed }
}
