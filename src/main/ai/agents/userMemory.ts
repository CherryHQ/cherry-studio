import { lstat, mkdir, open } from 'node:fs/promises'

import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'

import { type MemoryFiles, resolveMemoryFile } from './memoryFiles'

export function canUseUserMemory(sessionId: string, agentId?: string): boolean {
  const session = agentSessionService.getById(sessionId)
  const agent = session?.agentId ? agentService.getAgent(session.agentId) : null
  return (
    !!agent &&
    (!agentId || agent.id === agentId) &&
    agent.configuration?.userMemoryEnabled !== false &&
    !agentChannelService.findBySessionId(sessionId)
  )
}

export const userMemoryFiles: MemoryFiles = {
  directory: async () => {
    const directory = application.getPath('user.memory')
    await mkdir(directory, { recursive: true })
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('User memory must be a real directory')
    return directory
  },
  facts: 'USER_FACT.md',
  journal: 'USER_JOURNAL.jsonl'
}

export async function ensureUserMemory(): Promise<void> {
  const directory = await userMemoryFiles.directory()
  for (const name of [userMemoryFiles.facts, userMemoryFiles.journal]) {
    const file = await resolveMemoryFile(directory, name)
    try {
      const handle = await open(file, 'wx', 0o600)
      await handle.close()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const stat = await lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('User memory must be a regular file')
    }
  }
}
