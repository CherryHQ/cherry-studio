import { readFile } from 'node:fs/promises'

import * as z from 'zod'

import type { RuntimeForkCheckpoint } from '@data/services/agentSessionForkContract'
import type { AgentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { digestRelocationArtifact } from '@main/ai/agents/agentRelocationFiles'

export interface RelocatedCheckpoint {
  messageId: string
  checkpoint: RuntimeForkCheckpoint
}

type RelocationHistoryRow = ReturnType<AgentSessionMessageService['readWorkspaceRelocationHistory']>[number]

export interface RuntimeWorkspaceRelocationInput {
  oldPath: string
  newPath: string
  oldDataRoot: string
  directory: string
  history: Array<Omit<RelocationHistoryRow, 'checkpoint'> & { checkpoint: RuntimeForkCheckpoint | undefined }>
  assertAvailable(...files: string[]): Promise<void>
  stage(sources: readonly [string, ...string[]], target: string, prepared?: string): Promise<string>
}

export interface RuntimeWorkspaceRelocation {
  ownsArtifact(segments: readonly string[]): boolean
  prepare(input: RuntimeWorkspaceRelocationInput): Promise<RelocatedCheckpoint[]>
}

/** Cache native records only for one relocation, preserving the source bytes. */
export function createRelocationHistoryReader(root: string) {
  const historySchema = z.array(z.record(z.string(), z.unknown()))
  const entriesByFile = new Map<string, z.infer<typeof historySchema>>()

  return async (file: string) => {
    const cached = entriesByFile.get(file)

    if (cached) return cached
    await digestRelocationArtifact(root, file)
    const parsed: unknown[] = []

    for (const line of (await readFile(file, 'utf8')).split('\n')) {
      if (!line.trim()) continue

      try {
        parsed.push(JSON.parse(line))
      } catch (error) {
        // Native readers skip malformed records, including interrupted trailing writes.
        if (!(error instanceof SyntaxError)) throw error
      }
    }

    const entries = historySchema.parse(parsed)
    entriesByFile.set(file, entries)

    return entries
  }
}
