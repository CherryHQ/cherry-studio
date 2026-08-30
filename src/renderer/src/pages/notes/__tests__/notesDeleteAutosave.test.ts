import { describe, expect, it, vi } from 'vitest'

import { normalizePathValue } from '@renderer/services/NotesTreeService'

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
      const shouldCleanup =
        normalizedAfter === pendingDelete || normalizedAfter.startsWith(`${pendingDelete}/`)
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
})
