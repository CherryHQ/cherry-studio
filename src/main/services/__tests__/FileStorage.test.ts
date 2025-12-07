import * as fs from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fileStorage } from '../FileStorage'

describe('FileStorage', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks()
    // Setup default fs mocks to prevent directory creation during tests
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined)
  })

  describe('batchUpload', () => {
    const mockEvent = {} as Electron.IpcMainInvokeEvent

    beforeEach(() => {
      // Setup fs mocks
      vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.promises.readFile).mockResolvedValue('# Test content')
      vi.mocked(fs.promises.writeFile).mockResolvedValue()
      vi.mocked(fs.existsSync).mockReturnValue(false)
    })

    it('should allow all files by default', async () => {
      const filePaths = ['/src/test.md', '/src/image.png', '/src/doc.markdown', '/src/script.js']

      const result = await fileStorage.batchUpload(mockEvent, filePaths, '/target')

      expect(result.fileCount).toBe(4)
      expect(result.skippedFiles).toBe(0)
    })

    it('should filter by allowed extensions', async () => {
      const filePaths = ['/src/a.txt', '/src/b.txt', '/src/c.md']

      const result = await fileStorage.batchUpload(mockEvent, filePaths, '/target', {
        allowedExtensions: ['.txt'],
        fileNameTransform: (name) => name // Keep original name
      })

      expect(result.fileCount).toBe(2) // Only .txt files
      expect(result.skippedFiles).toBe(1)
    })

    it('should preserve folder structure', async () => {
      const filePaths = ['/source/a.md', '/source/sub/b.md', '/source/sub/deep/c.md']

      await fileStorage.batchUpload(mockEvent, filePaths, '/target')

      // Check mkdir was called for subdirectories
      expect(fs.promises.mkdir).toHaveBeenCalled()
    })

    // preserveFolderRoot functionality has been moved to uploadFolder API

    it('should handle empty file list', async () => {
      const result = await fileStorage.batchUpload(mockEvent, [], '/target')

      expect(result.fileCount).toBe(0)
      expect(result.folderCount).toBe(0)
      expect(result.skippedFiles).toBe(0)
    })

    it('should skip all files if allowed extensions do not match', async () => {
      const filePaths = ['/src/a.md', '/src/b.md']

      const result = await fileStorage.batchUpload(mockEvent, filePaths, '/target', {
        allowedExtensions: ['.txt']
      })

      expect(result.fileCount).toBe(0)
      expect(result.skippedFiles).toBe(2)
    })

    it('should transform filenames', async () => {
      const filePaths = ['/src/test.txt']

      await fileStorage.batchUpload(mockEvent, filePaths, '/target', {
        fileNameTransform: (name) => name.replace('.txt', '.md')
      })

      // Check that writeFile was called with .md extension
      expect(fs.promises.writeFile).toHaveBeenCalled()
      const calls = vi.mocked(fs.promises.writeFile).mock.calls
      const targetPath = calls[0][0] as string
      expect(targetPath).toMatch(/\.md$/)
    })

    it('should handle single file upload', async () => {
      const filePaths = ['/source/single.md']

      const result = await fileStorage.batchUpload(mockEvent, filePaths, '/target')

      expect(result.fileCount).toBe(1)
      expect(result.folderCount).toBe(0)
      expect(result.skippedFiles).toBe(0)
    })

    it('should create nested directories', async () => {
      // Use multiple files at different depths to force nested directory creation
      const filePaths = ['/source/a/b/c/deep.md', '/source/shallow.md']

      await fileStorage.batchUpload(mockEvent, filePaths, '/target')

      // Should create nested directories (a, a/b, a/b/c)
      expect(fs.promises.mkdir).toHaveBeenCalled()
      expect(fs.promises.writeFile).toHaveBeenCalled()
    })

    it('should handle file read/write errors gracefully', async () => {
      const filePaths = ['/source/test.md']

      vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(new Error('Read failed'))

      const result = await fileStorage.batchUpload(mockEvent, filePaths, '/target')

      // Should not throw, but report 0 successful uploads
      expect(result.fileCount).toBe(0)
    })

    it('should process files in batches', async () => {
      // Create 25 files (more than BATCH_SIZE of 10)
      const filePaths = Array.from({ length: 25 }, (_, i) => `/source/file${i}.md`)

      await fileStorage.batchUpload(mockEvent, filePaths, '/target')

      // All files should be processed
      expect(fs.promises.writeFile).toHaveBeenCalledTimes(25)
    })
  })
})
