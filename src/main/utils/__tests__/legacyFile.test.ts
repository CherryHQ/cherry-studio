import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import chardet from 'chardet'
import iconv from 'iconv-lite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FILE_TYPE } from '@shared/types/file'

import { readTextFileWithAutoEncoding, resolveAndValidatePath } from '../legacyFile'
import { getAllFiles, getFileType, untildify } from '../legacyFile'

// Mock dependencies
vi.mock('node:fs')
vi.mock('node:fs/promises')
vi.mock('node:os')
vi.mock('node:path')
vi.mock('uuid', () => ({
  v4: () => 'mock-uuid'
}))
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key) => {
      if (key === 'temp') return '/mock/temp'
      if (key === 'userData') return '/mock/userData'
      return '/mock/unknown'
    })
  }
}))

describe('file', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock path.extname
    vi.mocked(path.extname).mockImplementation((file) => {
      const parts = file.split('.')
      return parts.length > 1 ? `.${parts[parts.length - 1]}` : ''
    })

    // Mock path.basename
    vi.mocked(path.basename).mockImplementation((file) => {
      const parts = file.split('/')
      return parts[parts.length - 1]
    })

    // Mock path.join
    vi.mocked(path.join).mockImplementation((...args) => args.join('/'))

    // Mock os.homedir
    vi.mocked(os.homedir).mockReturnValue('/mock/home')
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('getFileType', () => {
    it('should return IMAGE for image extensions', () => {
      expect(getFileType('.jpg')).toBe(FILE_TYPE.IMAGE)
      expect(getFileType('.jpeg')).toBe(FILE_TYPE.IMAGE)
      expect(getFileType('.png')).toBe(FILE_TYPE.IMAGE)
      expect(getFileType('.gif')).toBe(FILE_TYPE.IMAGE)
      expect(getFileType('.webp')).toBe(FILE_TYPE.IMAGE)
      expect(getFileType('.bmp')).toBe(FILE_TYPE.IMAGE)
    })

    it('should return VIDEO for video extensions', () => {
      expect(getFileType('.mp4')).toBe(FILE_TYPE.VIDEO)
      expect(getFileType('.avi')).toBe(FILE_TYPE.VIDEO)
      expect(getFileType('.mov')).toBe(FILE_TYPE.VIDEO)
      expect(getFileType('.mkv')).toBe(FILE_TYPE.VIDEO)
      expect(getFileType('.flv')).toBe(FILE_TYPE.VIDEO)
    })

    it('should return AUDIO for audio extensions', () => {
      expect(getFileType('.mp3')).toBe(FILE_TYPE.AUDIO)
      expect(getFileType('.wav')).toBe(FILE_TYPE.AUDIO)
      expect(getFileType('.ogg')).toBe(FILE_TYPE.AUDIO)
      expect(getFileType('.flac')).toBe(FILE_TYPE.AUDIO)
      expect(getFileType('.aac')).toBe(FILE_TYPE.AUDIO)
    })

    it('should return TEXT for text extensions', () => {
      expect(getFileType('.txt')).toBe(FILE_TYPE.TEXT)
      expect(getFileType('.md')).toBe(FILE_TYPE.TEXT)
      expect(getFileType('.html')).toBe(FILE_TYPE.TEXT)
      expect(getFileType('.json')).toBe(FILE_TYPE.TEXT)
      expect(getFileType('.js')).toBe(FILE_TYPE.TEXT)
      expect(getFileType('.ts')).toBe(FILE_TYPE.TEXT)
      expect(getFileType('.css')).toBe(FILE_TYPE.TEXT)
      expect(getFileType('.java')).toBe(FILE_TYPE.TEXT)
      expect(getFileType('.py')).toBe(FILE_TYPE.TEXT)
    })

    it('should return DOCUMENT for document extensions', () => {
      expect(getFileType('.pdf')).toBe(FILE_TYPE.DOCUMENT)
      expect(getFileType('.pptx')).toBe(FILE_TYPE.DOCUMENT)
      expect(getFileType('.doc')).toBe(FILE_TYPE.DOCUMENT)
      expect(getFileType('.docx')).toBe(FILE_TYPE.DOCUMENT)
      expect(getFileType('.xlsx')).toBe(FILE_TYPE.DOCUMENT)
      expect(getFileType('.odt')).toBe(FILE_TYPE.DOCUMENT)
    })

    it('should return OTHER for unknown extensions', () => {
      expect(getFileType('.unknown')).toBe(FILE_TYPE.OTHER)
      expect(getFileType('')).toBe(FILE_TYPE.OTHER)
      expect(getFileType('.')).toBe(FILE_TYPE.OTHER)
      expect(getFileType('...')).toBe(FILE_TYPE.OTHER)
      expect(getFileType('.123')).toBe(FILE_TYPE.OTHER)
    })

    it('should handle case-insensitive extensions', () => {
      expect(getFileType('.JPG')).toBe(FILE_TYPE.IMAGE)
      expect(getFileType('.PDF')).toBe(FILE_TYPE.DOCUMENT)
      expect(getFileType('.Mp3')).toBe(FILE_TYPE.AUDIO)
      expect(getFileType('.HtMl')).toBe(FILE_TYPE.TEXT)
      expect(getFileType('.Xlsx')).toBe(FILE_TYPE.DOCUMENT)
    })

    it('should handle extensions without leading dot', () => {
      expect(getFileType('jpg')).toBe(FILE_TYPE.OTHER)
      expect(getFileType('pdf')).toBe(FILE_TYPE.OTHER)
      expect(getFileType('mp3')).toBe(FILE_TYPE.OTHER)
    })

    it('should handle extreme cases', () => {
      expect(getFileType('.averylongfileextensionname')).toBe(FILE_TYPE.OTHER)
      expect(getFileType('.tar.gz')).toBe(FILE_TYPE.OTHER)
      expect(getFileType('.文件')).toBe(FILE_TYPE.OTHER)
      expect(getFileType('.файл')).toBe(FILE_TYPE.OTHER)
    })
  })

  describe('getAllFiles', () => {
    it('should return all valid files recursively', () => {
      // Mock file system
      // @ts-ignore - override type for testing
      vi.spyOn(fs, 'readdirSync').mockImplementation((dirPath) => {
        if (dirPath === '/test') {
          return ['file1.txt', 'file2.pdf', 'subdir']
        } else if (dirPath === '/test/subdir') {
          return ['file3.md', 'file4.docx']
        }
        return []
      })

      vi.mocked(fs.statSync).mockImplementation((filePath) => {
        const isDir = String(filePath).endsWith('subdir')
        return {
          isDirectory: () => isDir,
          size: 1024
        } as fs.Stats
      })

      const result = getAllFiles('/test')

      expect(result).toHaveLength(4)
      expect(result[0].id).toBe('mock-uuid')
      expect(result[0].name).toBe('file1.txt')
      expect(result[0].type).toBe(FILE_TYPE.TEXT)
      expect(result[1].name).toBe('file2.pdf')
      expect(result[1].type).toBe(FILE_TYPE.DOCUMENT)
    })

    it('should skip hidden files', () => {
      // @ts-ignore - override type for testing
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['.hidden', 'visible.txt'])
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => false,
        size: 1024
      } as fs.Stats)

      const result = getAllFiles('/test')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('visible.txt')
    })

    it('should skip unsupported file types', () => {
      // @ts-ignore - override type for testing
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['image.jpg', 'video.mp4', 'audio.mp3', 'document.pdf'])
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => false,
        size: 1024
      } as fs.Stats)

      const result = getAllFiles('/test')

      // Should only include document.pdf as the others are excluded types
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('document.pdf')
      expect(result[0].type).toBe(FILE_TYPE.DOCUMENT)
    })

    it('should return empty array for empty directory', () => {
      // @ts-ignore - override type for testing
      vi.spyOn(fs, 'readdirSync').mockReturnValue([])

      const result = getAllFiles('/empty')

      expect(result).toHaveLength(0)
    })

    it('should handle file system errors', () => {
      // @ts-ignore - override type for testing
      vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
        throw new Error('Directory not found')
      })

      // Since the function doesn't have error handling, we expect it to propagate
      expect(() => getAllFiles('/nonexistent')).toThrow('Directory not found')
    })
  })

  describe('readTextFileWithAutoEncoding', () => {
    const mockFilePath = '/path/to/mock/file.txt'

    it('should read file with auto encoding', async () => {
      const content = '这是一段GB18030编码的测试内容'
      const buffer = Buffer.from(iconv.encode(content, 'GB18030'))

      // 模拟文件读取和编码检测
      vi.spyOn(fsPromises, 'readFile').mockResolvedValue(buffer)
      vi.spyOn(chardet, 'detectFile').mockResolvedValue('GB18030')

      const result = await readTextFileWithAutoEncoding(mockFilePath)
      expect(result).toBe(content)
    })

    it('should try to fix bad detected encoding', async () => {
      const content = '这是一段UTF-8编码的测试内容'
      const buffer = Buffer.from(iconv.encode(content, 'UTF-8'))

      // 模拟文件读取
      vi.spyOn(fsPromises, 'readFile').mockResolvedValue(buffer)
      vi.spyOn(chardet, 'detectFile').mockResolvedValue('GB18030')

      const result = await readTextFileWithAutoEncoding(mockFilePath)
      expect(result).toBe(content)
    })
  })

  describe('untildify', () => {
    it('should replace ~ with home directory for paths starting with ~', () => {
      const mockHome = '/mock/home'

      expect(untildify('~')).toBe(mockHome)
      expect(untildify('~/Documents')).toBe('/mock/home/Documents')
      expect(untildify('~\\Documents')).toBe('/mock/home\\Documents')
      expect(untildify('~/Documents/file.txt')).toBe('/mock/home/Documents/file.txt')
      expect(untildify('~\\Documents\\file.txt')).toBe('/mock/home\\Documents\\file.txt')
    })

    it('should not replace ~ when not at the beginning', () => {
      expect(untildify('folder/~/file')).toBe('folder/~/file')
      expect(untildify('/home/user/~')).toBe('/home/user/~')
      expect(untildify('Documents/~backup')).toBe('Documents/~backup')
    })

    it('should not replace ~ when not followed by path separator or end of string', () => {
      expect(untildify('~abc')).toBe('~abc')
      expect(untildify('~user')).toBe('~user')
      expect(untildify('~file.txt')).toBe('~file.txt')
    })

    it('should handle paths that do not start with ~', () => {
      expect(untildify('/absolute/path')).toBe('/absolute/path')
      expect(untildify('./relative/path')).toBe('./relative/path')
      expect(untildify('../parent/path')).toBe('../parent/path')
      expect(untildify('relative/path')).toBe('relative/path')
      expect(untildify('C:\\Windows\\System32')).toBe('C:\\Windows\\System32')
    })

    it('should handle edge cases', () => {
      expect(untildify('')).toBe('')
      expect(untildify(' ')).toBe(' ')
      expect(untildify('~/')).toBe('/mock/home/')
      expect(untildify('~\\')).toBe('/mock/home\\')
    })

    it('should handle special characters and unicode', () => {
      expect(untildify('~/文档')).toBe('/mock/home/文档')
      expect(untildify('~/папка')).toBe('/mock/home/папка')
      expect(untildify('~/folder with spaces')).toBe('/mock/home/folder with spaces')
      expect(untildify('~/folder-with-dashes')).toBe('/mock/home/folder-with-dashes')
      expect(untildify('~/folder_with_underscores')).toBe('/mock/home/folder_with_underscores')
    })
  })

  describe('resolveAndValidatePath', () => {
    beforeEach(() => {
      vi.mocked(path.resolve).mockImplementation((...args) => {
        const joined = args.filter(Boolean).join('/')
        const parts = joined.split('/').filter(Boolean)
        const resolved: string[] = []
        for (const part of parts) {
          if (part === '..') {
            resolved.pop()
          } else if (part !== '.') {
            resolved.push(part)
          }
        }
        return '/' + resolved.join('/')
      })
      Object.defineProperty(path, 'sep', { value: '/', configurable: true })
    })

    it('should resolve valid relative paths', () => {
      expect(resolveAndValidatePath('/base', 'file.txt')).toBe('/base/file.txt')
      expect(resolveAndValidatePath('/base', 'subdir/file.txt')).toBe('/base/subdir/file.txt')
      expect(resolveAndValidatePath('/base', './file.txt')).toBe('/base/file.txt')
    })

    it('should throw error for path traversal attacks', () => {
      vi.mocked(path.resolve).mockImplementation((...args) => {
        const [, relativePath] = args
        if (relativePath === '../etc/passwd') return '/etc/passwd'
        if (relativePath === '../sibling') return '/base/sibling'
        return args.filter(Boolean).join('/')
      })

      expect(() => resolveAndValidatePath('/base/dir', '../etc/passwd')).toThrow(
        'Invalid file path: path traversal detected'
      )
      expect(() => resolveAndValidatePath('/base/dir', '../sibling')).toThrow(
        'Invalid file path: path traversal detected'
      )
    })

    it('should reject empty path or dot (base directory itself)', () => {
      expect(() => resolveAndValidatePath('/base/dir', '')).toThrow('Invalid file path: path traversal detected')
      expect(() => resolveAndValidatePath('/base/dir', '.')).toThrow('Invalid file path: path traversal detected')
    })
  })
})
