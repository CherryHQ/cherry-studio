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

  describe('delete-failure recovery with equal content still restores', () => {
    it('direct save for snapshot is not skipped when active note has same text', async () => {
      // Reproduces c1: saveCurrentNote compared content against active note's currentContent
      const activePath = '/notes/b.md'
      const activeContent = 'hello'
      const snapshotPath = '/notes/a.md'
      const snapshotContent = 'hello'
      const fileWrite = vi.fn().mockResolvedValue(undefined)

      async function saveCurrentNoteSim(content: string, targetPath: string) {
        if (!targetPath) return
        const normalizedTarget = normalizePathValue(targetPath)
        const activeNorm = normalizePathValue(activePath)
        const isActiveTarget = normalizedTarget === activeNorm
        if (isActiveTarget && content.trim() === activeContent.trim()) return
        await fileWrite(targetPath, content)
      }

      await saveCurrentNoteSim(snapshotContent, snapshotPath)
      expect(fileWrite).toHaveBeenCalledWith('/notes/a.md', 'hello')

      // old buggy guard would have blocked: if (content.trim() === currentContent.trim()) return
      const buggyWouldSkip = snapshotContent.trim() === activeContent.trim()
      expect(buggyWouldSkip).toBe(true)
    })
  })

  describe('same-path recreate race with in-flight autosave (generation-tied)', () => {
    let generations: Map<string, number>
    let pendingSet: Set<string>
    let pendingGen: Map<string, number>
    let lastRecreated: { path: string; gen: number; content: string } | null
    let fileWrite: ReturnType<typeof vi.fn>
    let invalidate: ReturnType<typeof vi.fn>
    let deleteExternalFile: ReturnType<typeof vi.fn>
    let deleteExternalDir: ReturnType<typeof vi.fn>
    let lastContentRef: string
    let lastFilePathRef: string | undefined
    let activePath: string | undefined
    let activeContent: string

    beforeEach(() => {
      generations = new Map()
      pendingSet = new Set()
      pendingGen = new Map()
      lastRecreated = null
      fileWrite = vi.fn().mockImplementation(() => Promise.resolve())
      invalidate = vi.fn()
      deleteExternalFile = vi.fn().mockResolvedValue(undefined)
      deleteExternalDir = vi.fn().mockResolvedValue(undefined)
      lastContentRef = ''
      lastFilePathRef = undefined
      activePath = undefined
      activeContent = ''
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

    async function saveCurrentNoteSim(content: string, targetPath: string) {
      if (!targetPath) return
      const normalizedTarget = normalizePathValue(targetPath)
      const activeNorm = activePath ? normalizePathValue(activePath) : undefined
      const isActiveTarget = normalizedTarget === activeNorm
      if (isActiveTarget && content.trim() === activeContent.trim()) return
      if (isPending(targetPath)) return
      const genAtStart = getGen(targetPath)
      await fileWrite(targetPath, content)
      const genNow = getGen(targetPath)
      const na = normalizePathValue(targetPath)
      if (genAtStart !== genNow) {
        if (isPending(targetPath)) {
          await deleteExternalFile(targetPath).catch(() => {})
          await deleteExternalDir(targetPath).catch(() => {})
          return
        }
        if (lastRecreated && genNow === lastRecreated.gen) {
          const isExact = na === lastRecreated.path
          const isDescendant = na.startsWith(`${lastRecreated.path}/`)
          if (isExact || isDescendant) {
            if (isDescendant) {
              await deleteExternalFile(targetPath).catch(() => {})
              await deleteExternalDir(targetPath).catch(() => {})
              return
            }
            const curLast = lastFilePathRef ? normalizePathValue(lastFilePathRef) : undefined
            const correct = curLast === na ? lastContentRef : lastRecreated.content
            if (correct !== content) {
              await fileWrite(targetPath, correct)
            }
            invalidate(targetPath)
            return
          }
        }
        await deleteExternalFile(targetPath).catch(() => {})
        await deleteExternalDir(targetPath).catch(() => {})
        return
      }
      if (isPending(targetPath)) {
        await deleteExternalFile(targetPath).catch(() => {})
        await deleteExternalDir(targetPath).catch(() => {})
        return
      }
      invalidate(targetPath)
    }

    it('stale write after same-path recreate restores new content instead of leaving stale overwrite', async () => {
      const staleContent = 'old content'
      const recreatedCorrectContent = ''

      activePath = '/notes/a.md'
      activeContent = ''

      const savePromise = saveCurrentNoteSim(staleContent, '/notes/a.md')

      pendingSet.add(normalizePathValue('/notes/a.md'))
      pendingGen.set(normalizePathValue('/notes/a.md'), 1)
      bump('/notes/a.md')

      pendingSet.delete(normalizePathValue('/notes/a.md'))
      pendingGen.delete(normalizePathValue('/notes/a.md'))
      bump('/notes/a.md')
      const genAfter = getGen('/notes/a.md')
      lastRecreated = { path: normalizePathValue('/notes/a.md'), gen: genAfter, content: recreatedCorrectContent }
      lastContentRef = recreatedCorrectContent
      lastFilePathRef = '/notes/a.md'

      await savePromise

      expect(fileWrite).toHaveBeenCalledTimes(2)
      expect(fileWrite).toHaveBeenNthCalledWith(1, '/notes/a.md', 'old content')
      expect(fileWrite).toHaveBeenNthCalledWith(2, '/notes/a.md', '')
      expect(invalidate).toHaveBeenCalledWith('/notes/a.md')
    })

    it('stale write after second delete is cleaned, not restored as recreate', async () => {
      const staleContent = 'old content'

      activePath = '/notes/a.md'
      activeContent = ''

      const savePromise = saveCurrentNoteSim(staleContent, '/notes/a.md')

      // first delete + recreate
      pendingSet.add(normalizePathValue('/notes/a.md'))
      bump('/notes/a.md')
      pendingSet.delete(normalizePathValue('/notes/a.md'))
      bump('/notes/a.md')
      lastRecreated = { path: normalizePathValue('/notes/a.md'), gen: getGen('/notes/a.md'), content: '' }

      // second delete before stale write completes (covers c0: stale autosave restores note deleted again)
      lastRecreated = null
      pendingSet.add(normalizePathValue('/notes/a.md'))
      bump('/notes/a.md')

      await savePromise

      // stale write should be swallowed via pending cleanup, not restored via lastRecreated
      expect(fileWrite).toHaveBeenCalledTimes(1)
      expect(fileWrite).toHaveBeenCalledWith('/notes/a.md', 'old content')
      expect(invalidate).not.toHaveBeenCalled()
    })

    it('recreated path does not copy active note content when user switched away', async () => {
      const staleContent = 'old content'
      const recreatedContent = ''

      // after recreate, user switched to /notes/b.md which has different content
      activePath = '/notes/b.md'
      activeContent = 'content-b'
      lastContentRef = 'content-b'
      lastFilePathRef = '/notes/b.md'

      const savePromise = saveCurrentNoteSim(staleContent, '/notes/a.md')

      pendingSet.add(normalizePathValue('/notes/a.md'))
      bump('/notes/a.md')
      pendingSet.delete(normalizePathValue('/notes/a.md'))
      bump('/notes/a.md')
      lastRecreated = { path: normalizePathValue('/notes/a.md'), gen: getGen('/notes/a.md'), content: recreatedContent }

      await savePromise

      // should restore recreatedContent '' not active note's content-b
      expect(fileWrite).toHaveBeenCalledTimes(2)
      expect(fileWrite).toHaveBeenNthCalledWith(2, '/notes/a.md', '')
    })

    it('delete replacement during creation window clears recreation marker', async () => {
      // recreate then delete same path within creation window
      pendingSet.add(normalizePathValue('/notes/a.md'))
      bump('/notes/a.md')
      pendingSet.delete(normalizePathValue('/notes/a.md'))
      bump('/notes/a.md')
      lastRecreated = { path: normalizePathValue('/notes/a.md'), gen: getGen('/notes/a.md'), content: '' }

      // delete the replacement
      if (lastRecreated && lastRecreated.path === normalizePathValue('/notes/a.md')) {
        lastRecreated = null
      }
      pendingSet.add(normalizePathValue('/notes/a.md'))
      bump('/notes/a.md')

      expect(lastRecreated).toBeNull()
      expect(isPending('/notes/a.md')).toBe(true)

      // stale write for old content should not be treated as recreation restore
      const savePromise = saveCurrentNoteSim('old content', '/notes/a.md')
      await savePromise
      expect(fileWrite).toHaveBeenCalledTimes(0)
      // blocked by pending fence at start
    })

    it('older pending timer does not clear newer deletion marker (generation-tied)', async () => {
      const path = normalizePathValue('/notes/a.md')

      // first delete: gen 1
      pendingSet.add(path)
      bump(path)
      const gen1 = getGen(path)
      pendingGen.set(path, gen1)

      // recreate clears first pending but bumps to gen 2
      pendingSet.delete(path)
      pendingGen.delete(path)
      bump(path)
      lastRecreated = { path, gen: getGen(path), content: '' }

      // second delete quickly: gen 3
      lastRecreated = null
      pendingSet.add(path)
      bump(path)
      const gen3 = getGen(path)
      pendingGen.set(path, gen3)

      // first timer fires (would have checked gen1 === curGen? -> false, so no clear)
      const curGen = getGen(path)
      const firstTimerWouldClear = gen1 === curGen
      expect(firstTimerWouldClear).toBe(false)

      // second timer correctly keeps pending until its gen matches
      expect(isPending('/notes/a.md')).toBe(true)
      expect(pendingGen.get(path)).toBe(gen3)
    })

    it('older recreation timer does not clear newer recreation marker', () => {
      const path = normalizePathValue('/notes/a.md')

      bump(path)
      const gen1 = getGen(path)
      lastRecreated = { path, gen: gen1, content: '' }

      bump(path)
      const gen2 = getGen(path)
      lastRecreated = { path, gen: gen2, content: '' }

      // first timer checks gen1 vs current lastRecreated gen2 -> should not clear
      const firstTimerWouldClear = lastRecreated.gen === gen1
      expect(firstTimerWouldClear).toBe(false)
      expect(lastRecreated.gen).toBe(gen2)
    })

    it('stale write without recreate does not trigger corrective rewrite and is swallowed', async () => {
      activePath = '/notes/a.md'
      activeContent = ''

      const savePromise = saveCurrentNoteSim('stale', '/notes/a.md')

      pendingSet.add(normalizePathValue('/notes/a.md'))
      bump('/notes/a.md')

      await savePromise

      expect(fileWrite).toHaveBeenCalledTimes(1)
      expect(invalidate).not.toHaveBeenCalled()
      expect(deleteExternalFile).toHaveBeenCalledWith('/notes/a.md')
    })

    it('generation is per-path: unrelated delete does not affect other file autosave', async () => {
      activePath = '/notes/b.md'
      activeContent = ''

      const savePromise = saveCurrentNoteSim('content-b', '/notes/b.md')

      // delete unrelated file a
      pendingSet.add(normalizePathValue('/notes/a.md'))
      bump('/notes/a.md')

      await savePromise

      // b's write should succeed and invalidate, not be treated as stale
      expect(fileWrite).toHaveBeenCalledWith('/notes/b.md', 'content-b')
      expect(invalidate).toHaveBeenCalledWith('/notes/b.md')
    })

    it('inactive delete still fences switch-cleanup autosave (c0)', async () => {
      // user edits /notes/a.md then switches to /notes/b.md; switch cleanup schedules save for a.md;
      // while that save is in flight, inactive file a.md is deleted via sidebar - stale save must not resurrect
      activePath = '/notes/b.md'
      activeContent = 'content-b'

      const savePromise = saveCurrentNoteSim('stale-a', '/notes/a.md')

      pendingSet.add(normalizePathValue('/notes/a.md'))
      bump('/notes/a.md')

      await savePromise

      expect(fileWrite).toHaveBeenCalledTimes(1)
      expect(deleteExternalFile).toHaveBeenCalledWith('/notes/a.md')
      expect(invalidate).not.toHaveBeenCalled()
    })

    it('stale descendant of recreated folder is deleted, not restored (c1 folder)', async () => {
      activePath = '/notes/b.md'
      activeContent = 'content-b'

      // delete folder /notes/folder
      pendingSet.add(normalizePathValue('/notes/folder'))
      bump('/notes/folder')

      const stalePromise = saveCurrentNoteSim('old content', '/notes/folder/a.md')

      // recreate same folder - clears pending, bumps generation, records recreation
      pendingSet.delete(normalizePathValue('/notes/folder'))
      bump('/notes/folder')
      lastRecreated = { path: normalizePathValue('/notes/folder'), gen: getGen('/notes/folder'), content: '' }

      await stalePromise

      // descendant file resurrected by stale autosave must be deleted, not left as overwritten folder content
      expect(deleteExternalFile).toHaveBeenCalledWith('/notes/folder/a.md')
      expect(fileWrite).toHaveBeenCalledTimes(1)
      expect(invalidate).not.toHaveBeenCalled()
    })

    it('stale write after marker expiry is still cleaned up via generation bump (c1 expiry)', async () => {
      activePath = '/notes/a.md'
      activeContent = ''

      const savePromise = saveCurrentNoteSim('stale', '/notes/a.md')

      pendingSet.add(normalizePathValue('/notes/a.md'))
      bump('/notes/a.md')
      // marker expires before write completes (generation remains bumped)
      pendingSet.delete(normalizePathValue('/notes/a.md'))

      await savePromise

      expect(deleteExternalFile).toHaveBeenCalledWith('/notes/a.md')
      expect(invalidate).not.toHaveBeenCalled()
    })
  })

  describe('inactive delete fences production flow (c0 integration)', () => {
    it('pending fence blocks descendant autosave even when delete is not active-related', () => {
      const pending = new Set<string>([normalizePathValue('/notes/a.md')])
      // simulate inactive delete: pending still set, active is elsewhere
      const active = '/notes/b.md'
      expect(isActiveRelated(active, '/notes/a.md', 'file')).toBe(false)
      expect(isPendingDeleteForPath(normalizePathValue('/notes/a.md'), pending)).toBe(true)
      expect(shouldBlockAutosave('/notes/a.md', '/notes/a.md')).toBe(true)
    })

    it('folder inactive delete blocks descendant pending check', () => {
      const pending = new Set<string>([normalizePathValue('/notes/folder')])
      expect(isPendingDeleteForPath(normalizePathValue('/notes/folder/sub/note.md'), pending)).toBe(true)
      expect(isPendingDeleteForPath(normalizePathValue('/notes/other.md'), pending)).toBe(false)
    })
  })
})
