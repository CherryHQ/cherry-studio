import { AsyncLocalStorage } from 'node:async_hooks'
import type { BigIntStats } from 'node:fs'
import { constants } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import path from 'node:path'

import type { Context } from '@earendil-works/chord/context'
import type { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node'
import { Mutex } from 'async-mutex'

import { assertNotMemoryHardLink, memoryTarget } from '@main/ai/memory/memoryTarget'
import { canonicalizePathForContainment } from '@main/utils/file'

type Mutation = { identity?: string; release?: () => void }
const mutation = new AsyncLocalStorage<Mutation>()
const fileLocks = new Map<string, Mutex>()

export async function runDurableFileMutation<T>(operation: () => Promise<T>): Promise<T> {
  const state: Mutation = {}
  try {
    return await mutation.run(state, operation)
  } finally {
    state.release?.()
  }
}

/** Check the actual file used by native read, write and edit, after Pi selects its filename variant. */
export async function createDurableEnvironment(options: ConstructorParameters<typeof NodeExecutionEnv>[0]) {
  const { NodeExecutionEnv } = await import('@earendil-works/pi-durable/env/node')
  class DesktopEnvironment extends NodeExecutionEnv {
    private async filePath(candidate: string, context: Context, noFollow = false) {
      const resolved = await this.absolutePath(candidate, context)
      if (!resolved.ok) throw resolved.error
      const target = resolved.value
      // Preserve the SDK's final-component symlink check for noFollow reads.
      const resolvedPath = await canonicalizePathForContainment(noFollow ? path.dirname(target) : target, {
        allowMissing: true
      })
      const canonical = noFollow && resolvedPath ? path.join(resolvedPath, path.basename(target)) : resolvedPath
      if (!canonical || (await memoryTarget(target, canonical)))
        throw new Error('Use the memory editor for managed memory files')
      return canonical
    }

    override async openBinaryReader(file: string, options: { noFollow?: boolean } | undefined, context: Context) {
      return super.openBinaryReader(await this.filePath(file, context, options?.noFollow), options, context)
    }

    override async readTextFile(file: string, context: Context) {
      return super.readTextFile(await this.filePath(file, context), context)
    }

    override async writeFile(file: string, content: string | Uint8Array, context: Context) {
      const target = await this.filePath(file, context)
      if (!mutation.getStore()?.identity) return super.writeFile(target, content, context)
      context.abortSignal?.throwIfAborted()
      const handle = await open(target, constants.O_WRONLY | constants.O_NONBLOCK)
      try {
        await authorizeOpenedFile(target, await handle.stat({ bigint: true }))
        context.abortSignal?.throwIfAborted()
        await handle.truncate(0)
        await handle.writeFile(content, { signal: context.abortSignal })
        return { ok: true, value: undefined } as const
      } finally {
        await handle.close()
      }
    }
  }
  return new DesktopEnvironment({ ...options, authorizeOpenedFile })
}

async function authorizeOpenedFile(file: string, opened: BigIntStats) {
  if (opened.ino === 0n) throw new Error('The file has no verifiable identity')
  if (!opened.isFile() || (await memoryTarget(file))) throw new Error('Use the memory editor for managed memory files')
  const active = mutation.getStore()
  if (active) {
    const identity = `${opened.dev}:${opened.ino}`
    if (active.identity && active.identity !== identity) throw new Error('File identity changed during edit')
    if (!active.identity) {
      const lock = fileLocks.get(identity) ?? new Mutex()
      fileLocks.set(identity, lock)
      const release = await lock.acquire()
      active.identity = identity
      active.release = () => {
        release()
        if (!lock.isLocked()) fileLocks.delete(identity)
      }
    }
  }
  await assertNotMemoryHardLink(opened)
  const current = await stat(file, { bigint: true })
  if (
    current.dev !== opened.dev ||
    current.ino !== opened.ino ||
    current.nlink !== opened.nlink ||
    current.ctimeNs !== opened.ctimeNs
  )
    throw new Error('The file changed during authorization; retry the operation')
}
