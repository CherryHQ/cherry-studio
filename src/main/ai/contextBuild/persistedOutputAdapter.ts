/**
 * Per-request FileManager-backed `VFSStorageAdapter` for the context-build
 * truncation middleware — replaced the retired temp-dir VfsBlobService so
 * in-flight offloads land in the same durable store (and dedup to the same
 * entries) as persist-time trimming.
 *
 * `write` is the whole lifecycle: dedup-or-create the blob entry, then
 * immediately attach a provisional `tool_output` ref to this request's
 * assistant placeholder row — the blob is protected from the entry-cleanup
 * reaper from millisecond one (the 1h create grace is now just a backstop),
 * and the terminal `finalizeAssistantMessage` ref replace converges the set.
 * Offloaded paths are recorded for `getPhysicalPath` (the offloader resolves
 * the path after the write) and appended to the request's fs_read allow-list.
 */

import { application } from '@application'
import type { VFSStorageAdapter } from '@cherrystudio/ai-core'
import { messageService } from '@data/services/MessageService'

import { persistToolOutputText } from './toolOutputStore'

export interface FileManagerStorageAdapterOptions {
  /** Assistant placeholder row id — the provisional ref target. Must exist. */
  messageId: string
  /** The request's fs_read allow-list; offloaded blob paths are added so the
   *  model can read back what this turn just persisted. */
  persistedOutputPaths?: Set<string>
}

export function createFileManagerStorageAdapter(opts: FileManagerStorageAdapterOptions): VFSStorageAdapter {
  // filename (`vfs_<sha>.txt`) → physical path, for this request only. Also
  // backs `exists` — safe because entries are only recorded after the write
  // fully resolved (content-addressed contract).
  const offloaded = new Map<string, string>()

  return {
    async write(filename, content) {
      const { entry } = await persistToolOutputText(content)
      // Idempotent; a vanished row (message deleted mid-turn) is a no-op —
      // the blob then just waits out the create grace unreferenced.
      messageService.addToolOutputFileRef(opts.messageId, entry.id)
      const physicalPath = application.get('FileManager').getPhysicalPath(entry.id)
      offloaded.set(filename, physicalPath)
      opts.persistedOutputPaths?.add(physicalPath)
    },
    exists(filename) {
      return offloaded.has(filename)
    },
    read() {
      // Read-back goes through fs_read against the physical path, never the adapter.
      return null
    },
    getPhysicalPath(filename) {
      return offloaded.get(filename) ?? null
    }
  }
}
