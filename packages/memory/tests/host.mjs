import { createHash, randomUUID } from 'node:crypto'

import { MemoryStore } from '../dist/index.mjs'

export function fixture() {
  const files = new Map(),
    manifests = new Map()
  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
  let fileSetRevision = 0
  const owners = new Map()
  const storage = {
    applied: async (id, path) => owners.get(path) === id,
    fileSetVersion: async () => String(fileSetRevision),
    list: async () => [...files.keys()].sort(),
    async read(path, maxBytes) {
      const bytes = files.get(path)
      if (bytes && bytes.length > maxBytes) throw Error('Read exceeds limit')
      return bytes?.slice() ?? null
    },
    identity: async (path) => path,
    async replace(path, expected, bytes, check, condition) {
      const identity = await storage.identity(path)
      if (
        identity !== condition.identity ||
        String(fileSetRevision) !== condition.fileSetVersion ||
        JSON.stringify([...files.keys()].sort()) !== JSON.stringify(condition.paths)
      )
        throw Error('Target changed')
      for (const dep of condition.dependencies)
        if ((files.has(dep.path) ? sha256(files.get(dep.path)) : null) !== dep.hash) throw Error('Dependency changed')
      check()
      if ((files.has(path) ? sha256(files.get(path)) : null) !== expected) throw Error('stale')
      if (files.has(path) !== (bytes !== null)) fileSetRevision++
      if (bytes === null) files.delete(path)
      else files.set(path, bytes.slice())
      owners.set(path, condition.batchId)
      return String(fileSetRevision)
    }
  }
  const backup = {
    now: Date.now,
    createId: randomUUID,
    sha256,
    list: async () => [...manifests.keys()],
    read: async (path) => manifests.get(path)?.slice() ?? null,
    write: async (path, bytes) => {
      manifests.set(path, bytes.slice())
    },
    remove: async (path) => {
      manifests.delete(path)
    }
  }
  const access = { assertAuthorized() {} }
  const approve = async () => () => undefined
  return { files, storage, backup, access, approve, store: new MemoryStore(storage, backup) }
}
