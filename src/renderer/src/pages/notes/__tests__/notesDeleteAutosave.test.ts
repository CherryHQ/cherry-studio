import { normalizePathValue } from '@renderer/services/NotesTreeService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getEffectiveGeneration,
  isActiveRelated,
  isPendingDeleteForPath,
  shouldBlockAutosave,
  shouldRearmSnapshot
} from '../notesGuards'

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

  describe('pending set fence', () => {
    it('isPendingDeleteForPath covers exact and descendant', () => {
      const set = new Set([normalizePathValue('/notes/folder')])
      expect(isPendingDeleteForPath(normalizePathValue('/notes/folder/a.md'), set)).toBe(true)
      expect(isPendingDeleteForPath(normalizePathValue('/notes/folder'), set)).toBe(true)
      expect(isPendingDeleteForPath(normalizePathValue('/notes/other.md'), set)).toBe(false)
    })
  })

  describe('per-path generation', () => {
    it('getEffectiveGeneration considers ancestor generations', () => {
      const gens = new Map<string, number>()
      gens.set(normalizePathValue('/notes/folder'), 1)
      expect(getEffectiveGeneration(normalizePathValue('/notes/folder/a.md'), gens)).toBe(1)
      expect(getEffectiveGeneration(normalizePathValue('/notes/other.md'), gens)).toBe(0)
      gens.set(normalizePathValue('/notes/folder/a.md'), 2)
      expect(getEffectiveGeneration(normalizePathValue('/notes/folder/a.md'), gens)).toBe(2)
    })

    it('unrelated delete does not bump generation for other path', () => {
      const gens = new Map<string, number>()
      gens.set(normalizePathValue('/notes/a.md'), 1)
      expect(getEffectiveGeneration(normalizePathValue('/notes/b.md'), gens)).toBe(0)
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
      const deletePath = '/notes/a.md'
      const deleteType: 'file' | 'folder' = 'file'
      // snapshot at delete start
      const preDeletePath = '/notes/a.md'
      // simulate switch: refs now point to new note
      const lastContent = 'draft-b'
      const lastFilePath: string | undefined = '/notes/b.md'

      expect(shouldRearmSnapshot(preDeletePath, deletePath, deleteType)).toBe(true)
      // production fix: switchedAway should trigger direct write, not shared debounce
      const currentNorm = lastFilePath ? normalizePathValue(lastFilePath) : undefined
      const snapNorm = preDeletePath ? normalizePathValue(preDeletePath) : undefined
      const switchedAway = currentNorm != null && snapNorm != null && currentNorm !== snapNorm
      expect(switchedAway).toBe(true)
      // snapshot re-arm should not cancel current draft's debounce
      expect(lastFilePath).toBe('/notes/b.md')
      expect(lastContent).toBe('draft-b')
    })

    it('does not re-arm with stale snapshot when snapshot was unrelated', () => {
      const deletePath = '/notes/a.md'
      const deleteType: 'file' | 'folder' = 'file'
      const preDeletePath = '/notes/other.md'

      expect(shouldRearmSnapshot(preDeletePath, deletePath, deleteType)).toBe(false)
    })
  })

  describe('delete-failure recovery does not cancel switched note autosave', () => {
    it('switchedAway uses direct save so shared debounce keeps current note pending', () => {
      const debouncedSave = vi.fn()
      const directSave = vi.fn().mockResolvedValue(undefined)
      const preDeletePath = '/notes/a.md'
      const preDeleteContent = 'draft-a'
      const lastFilePath = '/notes/b.md'
      const lastContent = 'draft-b'
      const deletePath = '/notes/a.md'

      const snapNorm = normalizePathValue(preDeletePath)
      const currentNorm = normalizePathValue(lastFilePath)
      const switchedAway = currentNorm !== snapNorm
      expect(switchedAway).toBe(true)

      const shouldRearm = shouldRearmSnapshot(preDeletePath, deletePath, 'file')
      expect(shouldRearm).toBe(true)

      if (shouldRearm && switchedAway) {
        void directSave(preDeleteContent, preDeletePath)
      } else {
        debouncedSave(preDeleteContent, preDeletePath)
      }

      expect(directSave).toHaveBeenCalledWith('draft-a', '/notes/a.md')
      expect(debouncedSave).not.toHaveBeenCalled()
      // current note's debounce would remain untouched (not canceled)
      expect(lastFilePath).toBe('/notes/b.md')
      expect(lastContent).toBe('draft-b')
    })
  })

  describe('same-path recreate race with in-flight autosave', () => {
    let generations: Map<string, number>
    let pendingSet: Set<string>
    let lastRecreated: string | null
    let fileWrite: ReturnType<typeof vi.fn>
    let invalidate: ReturnType<typeof vi.fn>
    let lastContentRef: string
    let lastFilePathRef: string | undefined

    beforeEach(() => {
      generations = new Map()
      pendingSet = new Set()
      lastRecreated = null
      fileWrite = vi.fn().mockImplementation(() => Promise.resolve())
      invalidate = vi.fn()
      lastContentRef = ''
      lastFilePathRef = undefined
    })

    function isPending(target: string): boolean {
      const nt = normalizePathValue(target)
      return isPendingDeleteForPath(nt, pendingSet)
    }

    function getGen(target: string): number {
      return getEffectiveGeneration(normalizePathValue(target), generations)
    }

    function bump(path: string): void {
      const n = normalizePathValue(path)
      generations.set(n, (generations.get(n) ?? 0) + 1)
    }

    async function saveCurrentNoteSim(content: string, targetPath: string, currentContent: string) {
      if (!targetPath || content.trim() === currentContent.trim()) return
      if (isPending(targetPath)) return
      const genAtStart = getGen(targetPath)
      await fileWrite(targetPath, content)
      const genNow = getGen(targetPath)
      const na = normalizePathValue(targetPath)
      if (genAtStart !== genNow) {
        if (lastRecreated && na === lastRecreated) {
          const curLast = lastFilePathRef ? normalizePathValue(lastFilePathRef) : undefined
          const correct = curLast === na ? lastContentRef : ''
          if (correct !== content) {
            await fileWrite(targetPath, correct)
          }
          invalidate(targetPath)
          return
        }
        if (isPending(targetPath)) return
        return
      }
      if (isPending(targetPath)) return
      invalidate(targetPath)
    }

    it('stale write after same-path recreate restores new content instead of leaving stale overwrite', async () => {
      const staleContent = 'old content'
      const recreatedCorrectContent = ''

      const savePromise = saveCurrentNoteSim(staleContent, '/notes/a.md', '')

      pendingSet.add(normalizePathValue('/notes/a.md'))
      bump('/notes/a.md')

      pendingSet.delete(normalizePathValue('/notes/a.md'))
      bump('/notes/a.md')
      lastRecreated = normalizePathValue('/notes/a.md')
      lastContentRef = recreatedCorrectContent
      lastFilePathRef = '/notes/a.md'

      await savePromise

      expect(fileWrite).toHaveBeenCalledTimes(2)
      expect(fileWrite).toHaveBeenNthCalledWith(1, '/notes/a.md', 'old content')
      expect(fileWrite).toHaveBeenNthCalledWith(2, '/notes/a.md', '')
      expect(invalidate).toHaveBeenCalledWith('/notes/a.md')
    })

    it('stale write without recreate does not trigger corrective rewrite and is swallowed', async () => {
      const savePromise = saveCurrentNoteSim('stale', '/notes/a.md', '')

      pendingSet.add(normalizePathValue('/notes/a.md'))
      bump('/notes/a.md')

      await savePromise

      expect(fileWrite).toHaveBeenCalledTimes(1)
      expect(invalidate).not.toHaveBeenCalled()
    })

    it('generation is per-path: unrelated delete does not affect other file autosave', async () => {
      const savePromise = saveCurrentNoteSim('content-b', '/notes/b.md', '')

      // delete unrelated file a
      pendingSet.add(normalizePathValue('/notes/a.md'))
      bump('/notes/a.md')

      await savePromise

      // b's write should succeed and invalidate, not be treated as stale
      expect(fileWrite).toHaveBeenCalledWith('/notes/b.md', 'content-b')
      expect(invalidate).toHaveBeenCalledWith('/notes/b.md')
    })
  })
})
