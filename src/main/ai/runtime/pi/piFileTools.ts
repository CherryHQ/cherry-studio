import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'

import type { ToolDefinition } from '@earendil-works/pi-coding-agent'

import { application } from '@application'

import type { AgentFileWriteService } from '../AgentFileWriteService'
import type { loadPiSdk } from './piSdk'

/** Preserve SDK editing and path resolution; coordinate its actual filesystem writes. */
export function createPiFileTools(sdk: Awaited<ReturnType<typeof loadPiSdk>>, cwd: string) {
  const owner = {}
  const active = new Set<Promise<unknown>>()
  let stopped = false
  let locks: AgentFileWriteService | undefined
  const tools = [sdk.createWriteToolDefinition(cwd), sdk.createEditToolDefinition(cwd)].map(
    (definition): ToolDefinition => ({
      ...(definition as ToolDefinition),
      execute: async (...args) => {
        if (stopped) throw new Error('FILE_WRITE_OWNER_STOPPED: this execution has ended.')
        const leaseId = args[0]
        const work = (async () => {
          const guardedWrite = async (target: string, content: string) => {
            locks ??= application.get('AgentFileWriteService')
            await locks.acquire(owner, leaseId, target)
            args[2]?.throwIfAborted()
            await writeFile(target, content, 'utf8')
          }
          const tool =
            definition.name === 'write'
              ? sdk.createWriteToolDefinition(cwd, {
                  operations: {
                    mkdir: async (directory) => {
                      await mkdir(directory, { recursive: true })
                    },
                    writeFile: guardedWrite
                  }
                })
              : sdk.createEditToolDefinition(cwd, {
                  operations: {
                    readFile,
                    access: (target) => access(target, constants.R_OK | constants.W_OK),
                    writeFile: guardedWrite
                  }
                })
          try {
            return await (tool as ToolDefinition).execute(...args)
          } finally {
            locks?.release(owner, leaseId)
          }
        })()
        active.add(work)
        try {
          return await work
        } finally {
          active.delete(work)
        }
      }
    })
  )
  return {
    tools,
    async close() {
      stopped = true
      await Promise.allSettled([...active])
      locks?.runtimeExited(owner)
    }
  }
}
