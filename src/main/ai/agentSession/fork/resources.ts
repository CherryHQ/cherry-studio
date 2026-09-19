import { readdir, readFile, rm } from 'node:fs/promises'

import * as z from 'zod'

import { application } from '@application'
import { loggerService } from '@logger'
import { atomicWriteFile } from '@main/utils/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

const logger = loggerService.withContext('AgentSessionForkResources')

export const AgentSessionForkResourcesSchema = z.object({
  version: z.literal(1),
  operationId: z.uuid(),
  targetSessionId: z.uuid(),
  createdAt: z.number().int(),
  artifactDirectory: z.string(),
  artifactIdentity: z.string().optional(),
  workspace: z.string().optional(),
  workspaceIdentity: z.string().optional(),
  published: z.array(z.strictObject({ source: z.string(), target: z.string(), identity: z.string().optional() })),
  workspaceDisposition: z.literal('retained').optional()
})

export type AgentSessionForkResources = z.infer<typeof AgentSessionForkResourcesSchema>

export async function writeForkResources(resources: AgentSessionForkResources): Promise<void> {
  const file = application.getPath('feature.agents.forks', `${resources.operationId}.json`)
  await atomicWriteFile(AbsoluteFilePathSchema.parse(file), JSON.stringify(resources), { mode: 0o600 })
}

export async function readForkResources(): Promise<AgentSessionForkResources[]> {
  const root = application.getPath('feature.agents.forks')
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const result: AgentSessionForkResources[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const operationId = entry.name.slice(0, -5)
    if (!z.uuid().safeParse(operationId).success) continue
    try {
      const file = application.getPath('feature.agents.forks', entry.name)
      const resources = AgentSessionForkResourcesSchema.parse(JSON.parse(await readFile(file, 'utf8')))
      if (resources.operationId !== operationId) throw new Error('Fork resource identity mismatch')
      result.push(resources)
    } catch (error) {
      logger.warn('Unreadable fork resource record retained', { operationId, error })
    }
  }
  return result
}

export async function removeForkResources(operationId: string): Promise<void> {
  await rm(application.getPath('feature.agents.forks', `${operationId}.json`), { force: true })
}
