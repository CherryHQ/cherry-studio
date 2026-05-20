import { noteMetadataTable } from '@data/db/schemas/noteMetadata'
import { NoteMetadataService, noteMetadataService } from '@data/services/NoteMetadataService'
import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const ROOT_A = '/Users/test/Notes'
const ROOT_B = '/Users/test/OtherNotes'
const FOLDER = '/Users/test/Notes/Folder'
const NOTE = '/Users/test/Notes/Folder/a.md'
const RENAMED_FOLDER = '/Users/test/Notes/Renamed'

describe('NoteMetadataService', () => {
  const dbh = setupTestDatabase()

  it('should export a module-level singleton', () => {
    expect(noteMetadataService).toBeInstanceOf(NoteMetadataService)
  })

  it('should upsert and list note metadata scoped by root path', async () => {
    const first = await noteMetadataService.upsert({
      rootPath: ROOT_A,
      path: NOTE,
      nodeType: 'file',
      isStarred: true
    })
    const second = await noteMetadataService.upsert({
      rootPath: ROOT_A,
      path: NOTE,
      nodeType: 'file',
      isExpanded: true
    })
    await noteMetadataService.upsert({
      rootPath: ROOT_B,
      path: NOTE,
      nodeType: 'file',
      isStarred: true
    })

    expect(second.id).toBe(first.id)
    expect(second.isStarred).toBe(true)
    expect(second.isExpanded).toBe(true)

    const rows = await noteMetadataService.listByRoot(ROOT_A)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ rootPath: ROOT_A, path: NOTE, isStarred: true, isExpanded: true })
  })

  it('should delete a path recursively when requested', async () => {
    await noteMetadataService.upsert({ rootPath: ROOT_A, path: FOLDER, nodeType: 'folder', isExpanded: true })
    await noteMetadataService.upsert({ rootPath: ROOT_A, path: NOTE, nodeType: 'file', isStarred: true })

    await noteMetadataService.deleteByPath({ rootPath: ROOT_A, path: FOLDER, recursive: true })

    const rows = await dbh.db.select().from(noteMetadataTable).where(eq(noteMetadataTable.rootPath, ROOT_A))
    expect(rows).toHaveLength(0)
  })

  it('should rewrite folder paths recursively', async () => {
    await noteMetadataService.upsert({ rootPath: ROOT_A, path: FOLDER, nodeType: 'folder', isExpanded: true })
    await noteMetadataService.upsert({ rootPath: ROOT_A, path: NOTE, nodeType: 'file', isStarred: true })

    const result = await noteMetadataService.rewritePath({
      rootPath: ROOT_A,
      fromPath: FOLDER,
      toPath: RENAMED_FOLDER,
      recursive: true
    })

    expect(result.updated).toBe(2)
    const rows = await dbh.db
      .select()
      .from(noteMetadataTable)
      .where(and(eq(noteMetadataTable.rootPath, ROOT_A), eq(noteMetadataTable.path, `${RENAMED_FOLDER}/a.md`)))
    expect(rows).toHaveLength(1)
    expect(rows[0].isStarred).toBe(true)
  })

  it('should rewrite paths when stale target metadata already exists', async () => {
    await noteMetadataService.upsert({ rootPath: ROOT_A, path: FOLDER, nodeType: 'folder', isExpanded: true })
    await noteMetadataService.upsert({ rootPath: ROOT_A, path: NOTE, nodeType: 'file', isStarred: true })
    await noteMetadataService.upsert({ rootPath: ROOT_A, path: RENAMED_FOLDER, nodeType: 'folder', isExpanded: false })
    await noteMetadataService.upsert({
      rootPath: ROOT_A,
      path: `${RENAMED_FOLDER}/a.md`,
      nodeType: 'file',
      isStarred: false
    })

    const result = await noteMetadataService.rewritePath({
      rootPath: ROOT_A,
      fromPath: FOLDER,
      toPath: RENAMED_FOLDER,
      recursive: true
    })

    expect(result.updated).toBe(2)
    const rows = await dbh.db.select().from(noteMetadataTable).where(eq(noteMetadataTable.rootPath, ROOT_A))
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.path === RENAMED_FOLDER)).toMatchObject({ isExpanded: true })
    expect(rows.find((row) => row.path === `${RENAMED_FOLDER}/a.md`)).toMatchObject({ isStarred: true })
  })
})
