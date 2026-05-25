import { noteTable } from '@data/db/schemas/note'
import { NoteService, noteService } from '@data/services/NoteService'
import type { DataApiError } from '@shared/data/api'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const ROOT_A = '/Users/test/Notes'
const ROOT_B = '/Users/test/OtherNotes'
const FOLDER = '/Users/test/Notes/Folder'
const SIBLING_FOLDER = '/Users/test/Notes/Folder2'
const NOTE = '/Users/test/Notes/Folder/a.md'
const RENAMED_FOLDER = '/Users/test/Notes/Renamed'
const EMOJI_FOLDER = '/Users/test/Notes/📁'
const EMOJI_NOTE = '/Users/test/Notes/📁/a.md'
const RENAMED_EMOJI_FOLDER = '/Users/test/Notes/📦'

describe('NoteService', () => {
  const dbh = setupTestDatabase()

  it('should export a module-level singleton', () => {
    expect(noteService).toBeInstanceOf(NoteService)
  })

  it('should upsert and list note scoped by root path', async () => {
    const first = await noteService.upsert({
      rootPath: ROOT_A,
      path: NOTE,
      isStarred: true
    })
    const second = await noteService.upsert({
      rootPath: ROOT_A,
      path: NOTE,
      isExpanded: true
    })
    await noteService.upsert({
      rootPath: ROOT_B,
      path: NOTE,
      isStarred: true
    })

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    if (!first || !second) {
      throw new Error('Expected note rows to be upserted')
    }

    expect(second.id).toBe(first.id)
    expect(second.isStarred).toBe(true)
    expect(second.isExpanded).toBe(true)

    const rows = await noteService.listByRoot(ROOT_A)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ rootPath: ROOT_A, path: NOTE, isStarred: true, isExpanded: true })
  })

  it('should reject note upserts without fields', async () => {
    await expect(noteService.upsert({ rootPath: ROOT_A, path: NOTE })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR
    } satisfies Partial<DataApiError>)
  })

  it('should delete rows when all note flags are false', async () => {
    await noteService.upsert({ rootPath: ROOT_A, path: NOTE, isStarred: true })
    await expect(noteService.upsert({ rootPath: ROOT_A, path: NOTE, isStarred: false })).resolves.toBeNull()

    expect(await noteService.listByRoot(ROOT_A)).toHaveLength(0)

    await noteService.upsert({ rootPath: ROOT_A, path: FOLDER, isExpanded: true })
    await noteService.upsert({ rootPath: ROOT_A, path: FOLDER, isStarred: false })

    const expandedRows = await noteService.listByRoot(ROOT_A)
    expect(expandedRows).toHaveLength(1)
    expect(expandedRows[0]).toMatchObject({ path: FOLDER, isStarred: false, isExpanded: true })

    await expect(noteService.upsert({ rootPath: ROOT_A, path: FOLDER, isExpanded: false })).resolves.toBeNull()

    expect(await noteService.listByRoot(ROOT_A)).toHaveLength(0)

    await expect(
      noteService.upsert({
        rootPath: ROOT_A,
        path: '/Users/test/Notes/missing.md',
        isStarred: false,
        isExpanded: false
      })
    ).resolves.toBeNull()
    await expect(
      noteService.upsert({
        rootPath: ROOT_A,
        path: '/Users/test/Notes/other-missing.md',
        isExpanded: false
      })
    ).resolves.toBeNull()
    expect(await noteService.listByRoot(ROOT_A)).toHaveLength(0)
  })

  it('should reject note rows where both persisted flags are false', async () => {
    await expect(
      dbh.db.insert(noteTable).values({
        rootPath: ROOT_A,
        path: '/Users/test/Notes/invalid.md',
        isStarred: false,
        isExpanded: false
      })
    ).rejects.toThrow()
  })

  it('should delete a path recursively when requested', async () => {
    await noteService.upsert({ rootPath: ROOT_A, path: FOLDER, isExpanded: true })
    await noteService.upsert({ rootPath: ROOT_A, path: NOTE, isStarred: true })
    await noteService.upsert({ rootPath: ROOT_A, path: SIBLING_FOLDER, isExpanded: true })

    await noteService.deleteByPath({ rootPath: ROOT_A, path: FOLDER, recursive: true })

    const rows = await dbh.db.select().from(noteTable).where(eq(noteTable.rootPath, ROOT_A))
    expect(rows).toHaveLength(1)
    expect(rows[0].path).toBe(SIBLING_FOLDER)
  })

  it('should rewrite a single file path without touching descendants', async () => {
    await noteService.upsert({ rootPath: ROOT_A, path: NOTE, isStarred: true })
    await noteService.upsert({ rootPath: ROOT_A, path: `${NOTE}/child.md`, isStarred: true })

    const result = await noteService.rewritePath({
      rootPath: ROOT_A,
      fromPath: NOTE,
      toPath: '/Users/test/Notes/Folder/b.md',
      recursive: false
    })

    expect(result.updated).toBe(1)
    const rows = await dbh.db.select().from(noteTable).where(eq(noteTable.rootPath, ROOT_A))
    expect(rows.find((row) => row.path === '/Users/test/Notes/Folder/b.md')).toMatchObject({ isStarred: true })
    expect(rows.find((row) => row.path === `${NOTE}/child.md`)).toMatchObject({ isStarred: true })
  })

  it('should rewrite folder paths recursively', async () => {
    await noteService.upsert({ rootPath: ROOT_A, path: FOLDER, isExpanded: true })
    await noteService.upsert({ rootPath: ROOT_A, path: NOTE, isStarred: true })
    await noteService.upsert({ rootPath: ROOT_A, path: SIBLING_FOLDER, isExpanded: true })

    const result = await noteService.rewritePath({
      rootPath: ROOT_A,
      fromPath: FOLDER,
      toPath: RENAMED_FOLDER,
      recursive: true
    })

    expect(result.updated).toBe(2)
    const rows = await dbh.db.select().from(noteTable).where(eq(noteTable.rootPath, ROOT_A))
    expect(rows.find((row) => row.path === `${RENAMED_FOLDER}/a.md`)).toMatchObject({ isStarred: true })
    expect(rows.find((row) => row.path === SIBLING_FOLDER)).toMatchObject({ isExpanded: true })
  })

  it('should rewrite emoji folder paths recursively', async () => {
    await noteService.upsert({ rootPath: ROOT_A, path: EMOJI_FOLDER, isExpanded: true })
    await noteService.upsert({ rootPath: ROOT_A, path: EMOJI_NOTE, isStarred: true })

    const result = await noteService.rewritePath({
      rootPath: ROOT_A,
      fromPath: EMOJI_FOLDER,
      toPath: RENAMED_EMOJI_FOLDER,
      recursive: true
    })

    expect(result.updated).toBe(2)
    const rows = await dbh.db.select().from(noteTable).where(eq(noteTable.rootPath, ROOT_A))
    expect(rows.find((row) => row.path === `${RENAMED_EMOJI_FOLDER}/a.md`)).toMatchObject({ isStarred: true })
  })

  it('should rewrite paths when stale target note rows already exist', async () => {
    await noteService.upsert({ rootPath: ROOT_A, path: FOLDER, isExpanded: true })
    await noteService.upsert({ rootPath: ROOT_A, path: NOTE, isStarred: true })
    await noteService.upsert({ rootPath: ROOT_A, path: RENAMED_FOLDER, isExpanded: true })
    await noteService.upsert({
      rootPath: ROOT_A,
      path: `${RENAMED_FOLDER}/a.md`,
      isStarred: true
    })

    const result = await noteService.rewritePath({
      rootPath: ROOT_A,
      fromPath: FOLDER,
      toPath: RENAMED_FOLDER,
      recursive: true
    })

    expect(result.updated).toBe(2)
    const rows = await dbh.db.select().from(noteTable).where(eq(noteTable.rootPath, ROOT_A))
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.path === RENAMED_FOLDER)).toMatchObject({ isExpanded: true })
    expect(rows.find((row) => row.path === `${RENAMED_FOLDER}/a.md`)).toMatchObject({ isStarred: true })
  })
})
