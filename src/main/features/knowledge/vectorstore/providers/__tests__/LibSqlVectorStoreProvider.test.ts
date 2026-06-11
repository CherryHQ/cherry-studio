import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PathStorage from '../../../utils/storage/pathStorage'
import { deleteKnowledgeBaseDir } from '../../../utils/storage/pathStorage'
import { LibSqlVectorStoreProvider } from '../LibSqlVectorStoreProvider'

const { loggerErrorMock } = vi.hoisted(() => ({ loggerErrorMock: vi.fn() }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: loggerErrorMock,
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn()
    })
  }
}))

// delete() never touches the vector store binding, but the provider imports it
// at module load, so stub it to avoid pulling native libsql bindings into tests.
vi.mock('@vectorstores/libsql', () => ({ LibSQLVectorStore: class {} }))

// Keep the real path/deletion helpers (they run against a real temp dir) but
// wrap deleteKnowledgeBaseDir so a single test can force it to reject.
vi.mock('../../../utils/storage/pathStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof PathStorage>()
  return { ...actual, deleteKnowledgeBaseDir: vi.fn(actual.deleteKnowledgeBaseDir) }
})

describe('LibSqlVectorStoreProvider.delete', () => {
  let tempRoot: string | undefined
  const provider = new LibSqlVectorStoreProvider()

  beforeEach(() => {
    loggerErrorMock.mockClear()
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'libsql-provider-delete-'))
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.knowledgebase.data') {
        return tempRoot!
      }
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
  })

  afterEach(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true })
      tempRoot = undefined
    }
  })

  it('removes the entire base directory, including copied source files', async () => {
    const baseId = 'kb-1'
    const baseDir = path.join(tempRoot!, baseId)
    const metaDir = path.join(baseDir, '.cherry')
    fs.mkdirSync(metaDir, { recursive: true })
    fs.writeFileSync(path.join(metaDir, 'index.sqlite'), 'vector-db')
    fs.writeFileSync(path.join(baseDir, 'doc.pdf'), 'copied-source')
    fs.writeFileSync(path.join(baseDir, 'doc.md'), 'processed-artifact')

    await provider.delete(baseId)

    expect(fs.existsSync(baseDir)).toBe(false)
  })

  it('resolves even when the base directory does not exist', async () => {
    await expect(provider.delete('missing-base')).resolves.toBeUndefined()
  })

  it('propagates and logs errors from directory removal', async () => {
    const error = new Error('disk on fire')
    vi.mocked(deleteKnowledgeBaseDir).mockRejectedValueOnce(error)

    await expect(provider.delete('kb-1')).rejects.toThrow('disk on fire')
    expect(loggerErrorMock).toHaveBeenCalled()
  })
})
