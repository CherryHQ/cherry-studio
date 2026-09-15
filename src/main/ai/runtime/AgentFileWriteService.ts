import { lstat, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { Mutex } from 'async-mutex'

import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

interface FileWriteLease {
  path: string
  identity?: string
}
interface FileWriteOwner {
  leases: Map<string, FileWriteLease>
  released: Set<string>
}

/** Cooperative native file-tool exclusion within this Cherry Studio process. */
@Injectable('AgentFileWriteService')
@ServicePhase(Phase.WhenReady)
export class AgentFileWriteService extends BaseService {
  private readonly active = new Set<FileWriteLease>()
  private readonly owners = new WeakMap<object, FileWriteOwner>()
  private readonly exited = new WeakSet<object>()
  private readonly admission = new Mutex()
  private accepting = true

  protected onInit(): void {
    this.accepting = true
  }
  protected onStop(): void {
    this.accepting = false
  }

  async acquire(owner: object, id: string, filePath: string): Promise<void> {
    if (!id || !path.isAbsolute(filePath))
      throw new Error('FILE_TARGET_UNVERIFIABLE: an absolute file target is required.')
    if (
      process.platform === 'win32' &&
      filePath
        .slice(path.parse(filePath).root.length)
        .split(/[\\/]/)
        .some(
          (part) =>
            /[. ]$/.test(part) || part.includes(':') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
        )
    )
      throw new Error(
        'FILE_TARGET_UNVERIFIABLE: use a regular Windows path without device names, streams or ambiguous trailing characters.'
      )
    await this.admission.runExclusive(async () => {
      const state = this.owner(owner)
      if (!this.accepting || this.exited.has(owner) || state.released.has(id))
        throw new Error('FILE_WRITE_OWNER_STOPPED: this execution has ended.')
      const resolved = await canonicalFilePath(filePath)
      const info = await stat(resolved, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return undefined
      })
      if (info && (!info.isFile() || info.ino === 0n))
        throw new Error('FILE_TARGET_UNVERIFIABLE: a regular file with verifiable identity is required.')
      const identity = info ? `${info.dev}:${info.ino}` : undefined
      if (!this.accepting || this.exited.has(owner) || state.released.has(id))
        throw new Error('FILE_WRITE_OWNER_STOPPED: this execution has ended.')
      const previous = state.leases.get(id)
      if (previous) {
        if (previous.path === resolved || (identity && previous.identity === identity)) return
        throw new Error('FILE_TARGET_UNVERIFIABLE: a write call cannot change its target.')
      }
      for (const lease of this.active) {
        if (lease.path === resolved || (identity && lease.identity === identity))
          throw new Error(
            'FILE_WRITE_BUSY: another tool is writing this file. Wait for it to finish before retrying; do not bypass the lock with another tool.'
          )
        // Folding finds only ambiguous candidates; distinct real files never share a lock.
        if (
          lease.path.normalize('NFC').toLowerCase() === resolved.normalize('NFC').toLowerCase() &&
          (!identity || !lease.identity)
        )
          throw new Error(
            'FILE_TARGET_UNVERIFIABLE: an in-progress creation may name the same file. Retry after it finishes.'
          )
      }
      const lease = { path: resolved, identity }
      state.leases.set(id, lease)
      this.active.add(lease)
    })
  }

  hasWritesInside(directory: string): boolean {
    return [...this.active].some((lease) => {
      const relative = path.relative(directory, lease.path)
      return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    })
  } 
  release(owner: object, id: string): void {
    if (this.exited.has(owner)) return
    const state = this.owner(owner)
    const lease = state.leases.get(id)
    if (lease) this.active.delete(lease)
    state.leases.delete(id)
    state.released.add(id)
  }

  /** Process exit, or completion of every in-process tool body; never socket close or abort alone. */
  runtimeExited(owner: object): void {
    this.exited.add(owner)
    const state = this.owners.get(owner)
    for (const lease of state?.leases.values() ?? []) this.active.delete(lease)
    this.owners.delete(owner)
  }

  private owner(owner: object): FileWriteOwner {
    let state = this.owners.get(owner)
    if (!state) this.owners.set(owner, (state = { leases: new Map(), released: new Set() }))
    return state
  }
}

async function canonicalFilePath(filePath: string): Promise<string> {
  try {
    return await realpath(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const entry = await lstat(filePath).catch((failure: NodeJS.ErrnoException) => {
      if (failure.code !== 'ENOENT') throw failure
      return undefined
    })
    if (entry) throw new Error('FILE_TARGET_UNVERIFIABLE: the target is a dangling link.')
    const parent = path.dirname(filePath)
    if (parent === filePath) throw error
    return path.join(await canonicalFilePath(parent), path.basename(filePath))
  }
}
