import fs from 'fs/promises'
import path from 'path'

import { afterEach, describe, expect, it } from 'vitest'

import { handleEditTool } from '../tools/edit'
import { handleWriteTool } from '../tools/write'

// O2: edit/write attach { file_path, old_content, new_content } via `structuredContent` so a
// renderer can show a real diff — the model itself never sees this, only the `content` text.
describe('filesystem MCP structuredContent (O2 diff preview)', () => {
  const tempDirs: string[] = []

  async function createTempDir(prefix: string) {
    const tempRoot = path.join(process.cwd(), '.context', 'vitest-temp')
    await fs.mkdir(tempRoot, { recursive: true })
    const tempDir = await fs.mkdtemp(path.join(tempRoot, prefix))
    tempDirs.push(tempDir)
    return tempDir
  }

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })))
  })

  describe('write', () => {
    it('carries null old_content when creating a new file', async () => {
      const dir = await createTempDir('write-create-')
      const result = await handleWriteTool({ file_path: 'new.txt', content: 'hello\n' }, dir)

      expect(result.structuredContent).toEqual({
        file_path: 'new.txt',
        old_content: null,
        new_content: 'hello\n'
      })
    })

    it('captures the prior content when overwriting an existing file', async () => {
      const dir = await createTempDir('write-overwrite-')
      await fs.writeFile(path.join(dir, 'existing.txt'), 'old content\n', 'utf-8')

      const result = await handleWriteTool({ file_path: 'existing.txt', content: 'new content\n' }, dir)

      expect(result.structuredContent).toEqual({
        file_path: 'existing.txt',
        old_content: 'old content\n',
        new_content: 'new content\n'
      })
    })
  })

  describe('edit', () => {
    it('carries null old_content when old_string is empty and the file does not exist (create)', async () => {
      const dir = await createTempDir('edit-create-')
      const result = await handleEditTool({ file_path: 'created.txt', old_string: '', new_string: 'fresh\n' }, dir)

      expect(result.structuredContent).toEqual({
        file_path: 'created.txt',
        old_content: null,
        new_content: 'fresh\n'
      })
    })

    it('captures old_content when old_string is empty and the file already exists (overwrite)', async () => {
      const dir = await createTempDir('edit-overwrite-')
      await fs.writeFile(path.join(dir, 'overwrite.txt'), 'previous\n', 'utf-8')

      const result = await handleEditTool({ file_path: 'overwrite.txt', old_string: '', new_string: 'replaced\n' }, dir)

      expect(result.structuredContent).toEqual({
        file_path: 'overwrite.txt',
        old_content: 'previous\n',
        new_content: 'replaced\n'
      })
    })

    it('captures the full before/after content for a normal replacement', async () => {
      const dir = await createTempDir('edit-replace-')
      await fs.writeFile(path.join(dir, 'file.txt'), 'const x = 1\nconst y = 2\n', 'utf-8')

      const result = await handleEditTool(
        { file_path: 'file.txt', old_string: 'const x = 1', new_string: 'const x = 100' },
        dir
      )

      expect(result.structuredContent).toEqual({
        file_path: 'file.txt',
        old_content: 'const x = 1\nconst y = 2\n',
        new_content: 'const x = 100\nconst y = 2\n'
      })
    })
  })
})
