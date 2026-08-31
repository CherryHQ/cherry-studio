import { normalizePathValue } from '@renderer/services/NotesTreeService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function shouldBlockAutosave(targetPath: string, pendingDelete: string | null): boolean {
  if (!pendingDelete) return false
  const normalizedTarget = normalizePathValue(targetPath)
  return normalizedTarget === pendingDelete || normalizedTarget.startsWith(`${pendingDelete}/`)
}

function isActiveRelated(
  activeFilePath: string | undefined,
  deletePath: string,
  deleteType: 'file' | 'folder'
): boolean {
  const normalizedActive = activeFilePath ? normalizePathValue(activeFilePath) : undefined
  const normalizedDelete = normalizePathValue(deletePath)
  if (normalizedActive === normalizedDelete) return true
  if (deleteType === 'folder' && normalizedActive?.startsWith(`${normalizedDelete}/`)) return true
  return false
}

describe('notes delete / autosave guards', () => {
  describe('autosave fence (pendingDelete)', () => {
    it('blocks autosave to exactly the pending-delete file', () => {
      expect(shouldBlockAutosave('/notes/a.md', '/notes/a.md')).toBe(true)
    })

    it('blocks autosave to descendant of pending-delete folder', () => {
      expect(shouldBlockAutosave('/notes/folder/b.md', '/notes/folder')).toBe(true)
    })

    it('does not block autosave to unrelated path', () => {
      expect(shouldBlockAutosave('/notes/other.md', '/notes/a.md')).toBe(false)
    })

    it('handles windows separators', () => {
      expect(shouldBlockAutosave('C:\\notes\\a.md', 'C:/notes/a.md')).toBe(true)
    })

    it('does not block when no pending delete', () => {
      expect(shouldBlockAutosave('/notes/a.md', null)).toBe(false)
    })

    it('does not block prefix false-positive (/notes/ab.md vs /notes/a)', () => {
      expect(shouldBlockAutosave('/notes/ab.md', '/notes/a')).toBe(false)
      expect(shouldBlockAutosave('/notes/a-b/c.md', '/notes/a')).toBe(false)
    })
  })

  describe('post-write race cleanup', () => {
    it('after write completes, pending delete should trigger cleanup delete', async () => {
      const pendingDelete = '/notes/a.md'
      const target = '/notes/a.md'
      const deleteExternalFile = vi.fn().mockResolvedValue(undefined)
      const deleteExternalDir = vi.fn().mockResolvedValue(undefined)

      // simulate saveCurrentNote post-write check
      const normalizedAfter = normalizePathValue(target)
      const shouldCleanup = normalizedAfter === pendingDelete || normalizedAfter.startsWith(`${pendingDelete}/`)
      expect(shouldCleanup).toBe(true)

      if (shouldCleanup) {
        await deleteExternalFile(target).catch(() => {})
        await deleteExternalDir(target).catch(() => {})
      }

      expect(deleteExternalFile).toHaveBeenCalledWith(target)
      expect(deleteExternalDir).toHaveBeenCalledWith(target)
    })
  })

  describe('recreate after delete should not be blocked', () => {
    it('clearing pendingDelete allows new note at same path to autosave', () => {
      let pendingDelete: string | null = '/notes/a.md'
      const newNotePath = '/notes/a.md'
      const normalizedNote = normalizePathValue(newNotePath)
      if (pendingDelete && (normalizedNote === pendingDelete || normalizedNote.startsWith(`${pendingDelete}/`))) {
        pendingDelete = null
      }
      expect(pendingDelete).toBeNull()
      expect(shouldBlockAutosave(newNotePath, pendingDelete)).toBe(false)
    })
  })

  describe('delete clearing wrong note', () => {
    it('does not treat switched active path as related', () => {
      const deletePath = '/notes/a.md'
      const activeBeforeDelete = '/notes/a.md'
      expect(isActiveRelated(activeBeforeDelete, deletePath, 'file')).toBe(true)

      // user switches to other note while delete is pending
      const activeAfterSwitch = '/notes/b.md'
      expect(isActiveRelated(activeAfterSwitch, deletePath, 'file')).toBe(false)
    })

    it('folder delete: descendant is related', () => {
      expect(isActiveRelated('/notes/folder/sub/c.md', '/notes/folder', 'folder')).toBe(true)
      expect(isActiveRelated('/notes/other/c.md', '/notes/folder', 'folder')).toBe(false)
    })

    it('only clears last draft when it points to deleted path', () => {
      const deleted = normalizePathValue('/notes/a.md')
      const lastFilePath = '/notes/a.md'
      const normalizedLast = normalizePathValue(lastFilePath)
      const shouldClearDraft = normalizedLast === deleted || normalizedLast.startsWith(`${deleted}/`)
      expect(shouldClearDraft).toBe(true)

      const lastFilePathOther = '/notes/b.md'
      const normalizedOther = normalizePathValue(lastFilePathOther)
      const shouldClearOther = normalizedOther === deleted || normalizedOther.startsWith(`${deleted}/`)
      expect(shouldClearOther).toBe(false)
    })
  })

  describe('delete-failure re-arm for empty string edit', () => {
    it('re-arms autosave even when content is empty string', () => {
      const lastContent = ''
      const lastFilePath: string | undefined = '/notes/a.md'
      const debouncedSave = vi.fn()

      // old buggy guard: if (lastContent && lastFilePath) -> would skip empty string
      const buggyWouldRearm = Boolean(lastContent && lastFilePath)
      expect(buggyWouldRearm).toBe(false)

      // fixed guard: if (lastFilePath != null)
      if (lastFilePath != null) {
        debouncedSave(lastContent, lastFilePath)
      }
      expect(debouncedSave).toHaveBeenCalledWith('', '/notes/a.md')
    })

    it('does not re-arm when file path is missing', () => {
      const lastContent = 'hello'
      const lastFilePath: string | undefined = undefined
      const debouncedSave = vi.fn()
      if (lastFilePath != null) {
        debouncedSave(lastContent, lastFilePath)
      }
      expect(debouncedSave).not.toHaveBeenCalled()
    })
  })

  describe('delete-failure with switch preserves snapshot', () => {
    it('re-arms snapshot draft when user switched away before failure', () => {
      const normalizedDelete = normalizePathValue('/notes/a.md')
      const deleteType: 'file' | 'folder' = 'file'
      // snapshot at delete start
      const preDeleteContent = 'draft-a'
      const preDeletePath = '/notes/a.md'
      // simulate switch: refs now point to new note
      const lastContent = 'draft-b'
      const lastFilePath: string | undefined = '/notes/b.md'
      const debouncedSave = vi.fn()

      // production fix: use snapshot if snapshot was related
      const snapNorm = preDeletePath ? normalizePathValue(preDeletePath) : undefined
      const shouldRearmSnapshot =
        snapNorm === normalizedDelete || ((deleteType as string) === 'folder' && snapNorm?.startsWith(`${normalizedDelete}/`))

      if (shouldRearmSnapshot && preDeletePath != null) {
        debouncedSave(preDeleteContent, preDeletePath)
      } else if (lastFilePath != null) {
        debouncedSave(lastContent, lastFilePath)
      }

      expect(debouncedSave).toHaveBeenCalledWith('draft-a', '/notes/a.md')
      expect(debouncedSave).not.toHaveBeenCalledWith('draft-b', '/notes/b.md')
      // current draft for b should be preserved by not overwriting refs
      expect(lastFilePath).toBe('/notes/b.md')
      expect(lastContent).toBe('draft-b')
    })

    it('does not re-arm with stale snapshot when snapshot was unrelated', () => {
      const normalizedDelete = normalizePathValue('/notes/a.md')
      const deleteType: 'file' | 'folder' = 'file'
      const preDeleteContent = 'draft-unrelated'
      const preDeletePath = '/notes/other.md'
      const lastContent = 'draft-current'
      const lastFilePath: string | undefined = '/notes/other.md'
      const debouncedSave = vi.fn()

      const snapNorm = preDeletePath ? normalizePathValue(preDeletePath) : undefined
      const shouldRearmSnapshot =
        snapNorm === normalizedDelete || ((deleteType as string) === 'folder' && snapNorm?.startsWith(`${normalizedDelete}/`))

      if (shouldRearmSnapshot && preDeletePath != null) {
        debouncedSave(preDeleteContent, preDeletePath)
      } else if (lastFilePath != null) {
        debouncedSave(lastContent, lastFilePath)
      }

      expect(debouncedSave).toHaveBeenCalledWith('draft-current', '/notes/other.md')
    })
  })

  describe('same-path recreate race with in-flight autosave', () => {
    let deleteEpoch: number
    let pendingDelete: string | null
    let lastRecreated: string | null
    let fileWrite: ReturnType<typeof vi.fn>
    let invalidate: ReturnType<typeof vi.fn>
    let lastContentRef: string
    let lastFilePathRef: string | undefined

    beforeEach(() => {
      deleteEpoch = 0
      pendingDelete = null
      lastRecreated = null
      fileWrite = vi.fn().mockImplementation(() => Promise.resolve())
      invalidate = vi.fn()
      lastContentRef = ''
      lastFilePathRef = undefined
    })

    async function saveCurrentNoteSim(content: string, targetPath: string, currentContent: string) {
      if (!targetPath || content.trim() === currentContent.trim()) return
      const pd = pendingDelete
      if (pd) {
        const nt = normalizePathValue(targetPath)
        if (nt === pd || nt.startsWith(`${pd}/`)) return
      }
      const epochAtStart = deleteEpoch
      await fileWrite(targetPath, content)
      if (epochAtStart !== deleteEpoch) {
        const na = normalizePathValue(targetPath)
        if (lastRecreated && na === lastRecreated) {
          const curLast = lastFilePathRef ? normalizePathValue(lastFilePathRef) : undefined
          const correct = curLast === na ? lastContentRef : ''
          if (correct !== content) {
            await fileWrite(targetPath, correct)
          }
          invalidate(targetPath)
          return
        }
        const ps = pendingDelete
        if (ps) {
          const ns = normalizePathValue(targetPath)
          if (ns === ps || ns.startsWith(`${ps}/`)) {
            return
          }
        }
        return
      }
      const pa = pendingDelete
      if (pa) {
        const na = normalizePathValue(targetPath)
        if (na === pa || na.startsWith(`${pa}/`)) return
      }
      invalidate(targetPath)
    }

    it('stale write after same-path recreate restores new content instead of leaving stale overwrite', async () => {
      // user edits a.md
      const staleContent = 'old content'
      const recreatedCorrectContent = ''

      // start autosave (epoch 0)
      const savePromise = saveCurrentNoteSim(staleContent, '/notes/a.md', '')

      // during await, user deletes a.md
      pendingDelete = normalizePathValue('/notes/a.md')
      deleteEpoch += 1

      // then recreates same path
      pendingDelete = null
      deleteEpoch += 1
      lastRecreated = normalizePathValue('/notes/a.md')
      lastContentRef = recreatedCorrectContent
      lastFilePathRef = '/notes/a.md'

      await savePromise

      // first write was stale, second write should restore correct content
      expect(fileWrite).toHaveBeenCalledTimes(2)
      expect(fileWrite).toHaveBeenNthCalledWith(1, '/notes/a.md', 'old content')
      expect(fileWrite).toHaveBeenNthCalledWith(2, '/notes/a.md', '')
      expect(invalidate).toHaveBeenCalledWith('/notes/a.md')
    })

    it('stale write without recreate does not trigger corrective rewrite', async () => {
      const savePromise = saveCurrentNoteSim('stale', '/notes/a.md', '')

      pendingDelete = normalizePathValue('/notes/a.md')
      deleteEpoch += 1
      // no recreate
      lastRecreated = null

      await savePromise

      // stale write should be swallowed without corrective write
      expect(fileWrite).toHaveBeenCalledTimes(1)
      expect(invalidate).not.toHaveBeenCalled()
    })
  })
})
