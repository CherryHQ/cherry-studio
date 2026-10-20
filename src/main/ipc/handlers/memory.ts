import { readMemoryFacts, searchMemoryJournal, updateMemoryFacts } from '@main/ai/agents/memoryFiles'
import { ensureUserMemory, userMemoryFiles } from '@main/ai/agents/userMemory'
import type { memoryRequestSchemas } from '@shared/ipc/schemas/memory'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const memoryHandlers: IpcHandlersFor<typeof memoryRequestSchemas> = {
  'memory.user.facts.read': async () => {
    await ensureUserMemory()
    return readMemoryFacts(userMemoryFiles)
  },
  'memory.user.facts.update': async ({ content, expectedRevision }) => {
    await ensureUserMemory()
    return updateMemoryFacts(userMemoryFiles, content, expectedRevision)
  },
  'memory.user.journal.search': async ({ query, tag, limit }) => {
    await ensureUserMemory()
    return (await searchMemoryJournal(userMemoryFiles, query, tag, limit)) ?? []
  }
}
