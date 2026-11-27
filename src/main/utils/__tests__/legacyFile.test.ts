import * as fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import chardet from 'chardet'
import iconv from 'iconv-lite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readTextFileWithAutoEncoding, resolveAndValidatePath, untildify } from '../legacyFile'

// Mock dependencies
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

    // Mock path.join
    vi.mocked(path.join).mockImplementation((...args) => args.join('/'))

    // Mock os.homedir
    vi.mocked(os.homedir).mockReturnValue('/mock/home')
  })

  afterEach(() => {
    vi.resetAllMocks()
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
