import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { AgentSessionForkError } from '../fork'

/** Recovery records the SDK-selected project only after reopening its copied archive. */
export async function findClaudeSessionArchive(configDir: string, sessionId: string, cwd: string): Promise<string> {
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) throw new AgentSessionForkError('history_corrupt')
  const root = path.join(configDir, 'projects')
  const record = path.join(configDir, '.cherry-workspace-recovery', `${sessionId}.json`)
  let hasRecord = false
  try {
    const stat = await lstat(record)
    hasRecord = true
    if (!stat.isFile() || stat.isSymbolicLink()) throw new AgentSessionForkError('history_corrupt')
    const value = JSON.parse(await readFile(record, 'utf8'))
    if (
      value.version !== 2 ||
      value.sessionId !== sessionId ||
      typeof value.projectKey !== 'string' ||
      !value.projectKey ||
      /[\\/]/.test(value.projectKey) ||
      ['.', '..'].includes(value.projectKey)
    ) {
      throw new AgentSessionForkError('history_corrupt')
    }
    // A verified copy is not a committed workspace binding. Fork's caller supplies the
    // current DB-bound workspace, so a rejected recovery still reads the retained original.
    let key: string
    {
      if (
        typeof value.sourceCwd !== 'string' ||
        typeof value.targetCwd !== 'string' ||
        typeof value.sourceProjectKey !== 'string' ||
        !value.sourceProjectKey ||
        /[\\/]/.test(value.sourceProjectKey) ||
        ['.', '..'].includes(value.sourceProjectKey)
      )
        throw new AgentSessionForkError('history_corrupt')
      if (path.resolve(cwd) === value.targetCwd) key = value.projectKey
      else if (path.resolve(cwd) === value.sourceCwd) key = value.sourceProjectKey
      else throw new AgentSessionForkError('history_changed')
    }
    const project = path.join(root, key)
    const projectStat = await lstat(project)
    if (!projectStat.isDirectory() || projectStat.isSymbolicLink()) throw new AgentSessionForkError('history_corrupt')
    return path.join(project, `${sessionId}.jsonl`)
  } catch (error) {
    if (hasRecord || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // No recovery record: preserve the original uniqueness check for unrelated archives.
  }
  const files: string[] = []
  for (const project of await readdir(root, { withFileTypes: true })) {
    if (!project.isDirectory() || project.isSymbolicLink()) continue
    const directory = path.join(root, project.name)
    if ((await readdir(directory)).includes(sessionId + '.jsonl'))
      files.push(path.join(directory, sessionId + '.jsonl'))
  }
  if (files.length !== 1) throw new AgentSessionForkError(files.length ? 'history_corrupt' : 'history_missing')
  return files[0]
}
