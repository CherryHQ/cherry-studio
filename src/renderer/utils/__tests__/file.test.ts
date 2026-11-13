import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  anyFileExt,
  formatFileSize,
  getFileDirectory,
  getFileExtension,
  isSupportedExtension,
  isSupportedFile,
  removeFileExtension,
  removeSpecialCharactersForFileName
} from '../file'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))

beforeEach(() => {
  mocks.request.mockReset()
  mocks.request.mockResolvedValue({ kind: 'file', type: 'other' })
})

describe('file', () => {
  describe('getFileDirectory', () => {
    it('should return directory path for normal file path', () => {
      // 验证普通文件路径的目录提取
      const filePath = 'path/to/file.txt'
      const result = getFileDirectory(filePath)
      expect(result).toBe('path/to')
    })

    it('should return empty string for file without directory', () => {
      // 验证没有目录的文件路径
      const filePath = 'file.txt'
      const result = getFileDirectory(filePath)
      expect(result).toBe('')
    })

    it('should handle absolute path correctly', () => {
      // 验证绝对路径的目录提取
      const filePath = '/root/path/to/file.txt'
      const result = getFileDirectory(filePath)
      expect(result).toBe('/root/path/to')
    })

    it('should handle empty string input', () => {
      // 验证空字符串输入的边界情况
      const filePath = ''
      const result = getFileDirectory(filePath)
      expect(result).toBe('')
    })
  })

  describe('getFileExtension', () => {
    it('should return lowercase extension for normal file', () => {
      // 验证普通文件的扩展名提取
      const filePath = 'document.pdf'
      const result = getFileExtension(filePath)
      expect(result).toBe('.pdf')
    })

    it('should convert uppercase extension to lowercase', () => {
      // 验证大写扩展名转换为小写
      const filePath = 'image.PNG'
      const result = getFileExtension(filePath)
      expect(result).toBe('.png')
    })

    it('should return dot only for file without extension', () => {
      // 验证没有扩展名的文件
      const filePath = 'noextension'
      const result = getFileExtension(filePath)
      expect(result).toBe('.')
    })

    it('should handle hidden files with extension', () => {
      // 验证带有扩展名的隐藏文件
      const filePath = '.config.json'
      const result = getFileExtension(filePath)
      expect(result).toBe('.json')
    })

    it('should handle empty string input', () => {
      // 验证空字符串输入的边界情况
      const filePath = ''
      const result = getFileExtension(filePath)
      expect(result).toBe('.')
    })
  })

  describe('removeFileExtension', () => {
    it('should strip a plain extension', () => {
      expect(removeFileExtension('document.pdf')).toBe('document')
      expect(removeFileExtension('archive.tar.gz')).toBe('archive.tar')
      expect(removeFileExtension('noextension')).toBe('noextension')
    })

    it('should keep a leading-dot file name intact', () => {
      // A leading dot starts a hidden file name, not an extension — stripping it
      // used to yield an empty string as the pasted attachment's origin_name.
      expect(removeFileExtension('.env')).toBe('.env')
      expect(removeFileExtension('.gitignore')).toBe('.gitignore')
      expect(removeFileExtension('.config.json')).toBe('.config')
    })

    it('should only consider the base name when the path has dots in directories', () => {
      expect(removeFileExtension('/srv/app.d/file')).toBe('/srv/app.d/file')
      expect(removeFileExtension('/home/john.doe/notes')).toBe('/home/john.doe/notes')
      expect(removeFileExtension('C:\\dir.x\\name')).toBe('C:\\dir.x\\name')
    })
  })

  describe('formatFileSize', () => {
    it('renders missing or non-finite sizes as a dash', () => {
      expect(formatFileSize(null)).toBe('—')
      expect(formatFileSize(undefined)).toBe('—')
      expect(formatFileSize(Number.NaN)).toBe('—')
      expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe('—')
    })

    it('keeps sizes below 1 KB in bytes', () => {
      expect(formatFileSize(0)).toBe('0 B')
      expect(formatFileSize(500)).toBe('500 B')
      expect(formatFileSize(1023)).toBe('1023 B')
    })

    it('shows one decimal below 10 and whole numbers from 10 up', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB')
      expect(formatFileSize(1536)).toBe('1.5 KB')
      expect(formatFileSize(10 * 1024)).toBe('10 KB')
      expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
      expect(formatFileSize(15.3 * 1024 * 1024)).toBe('15 MB')
      expect(formatFileSize(2.5 * 1024 ** 3)).toBe('2.5 GB')
    })

    it('caps the unit at TB', () => {
      expect(formatFileSize(2048 * 1024 ** 4)).toBe('2048 TB')
    })
  })

  describe('removeSpecialCharactersForFileName', () => {
    it('should remove invalid characters for filename', () => {
      // 验证移除文件名中的非法字符
      expect(removeSpecialCharactersForFileName('Hello:<>World\nTest')).toBe('Hello___World Test')
    })

    it('should return original string if no invalid characters', () => {
      // 验证没有非法字符的字符串
      expect(removeSpecialCharactersForFileName('HelloWorld')).toBe('HelloWorld')
    })

    it('should return empty string for empty input', () => {
      // 验证空字符串
      expect(removeSpecialCharactersForFileName('')).toBe('')
    })
  })

  describe('isSupportedFile', () => {
    it('accepts a listed extension without consulting the file', async () => {
      expect(await isSupportedFile('/tmp/report.pdf', new Set(['.pdf']))).toBe(true)
      expect(mocks.request).not.toHaveBeenCalled()
    })

    it('accepts an unlisted extension when the file content is text', async () => {
      mocks.request.mockResolvedValue({ kind: 'file', type: 'text' })

      expect(await isSupportedFile('/tmp/netlist.sp', new Set(['.pdf']))).toBe(true)
    })

    it('rejects an unlisted binary extension', async () => {
      expect(await isSupportedFile('/tmp/weights.onnx', new Set(['.pdf']))).toBe(false)
    })

    it('accepts any extension when the allowlist carries the wildcard', async () => {
      // The wildcard means "this caller only needs the path" — an unknown binary
      // format must not be rejected on a caller that never reads the bytes.
      expect(await isSupportedFile('/tmp/weights.onnx', new Set([anyFileExt]))).toBe(true)
    })
  })

  describe('isSupportedExtension', () => {
    // The pathless-paste checks (clipboard images) can only consult the allowlist, so
    // the array form of the same question has to answer identically to isSupportedFile.
    it('accepts a listed extension', () => {
      expect(isSupportedExtension('.png', ['.png'])).toBe(true)
    })

    it('rejects an unlisted extension without the wildcard', () => {
      expect(isSupportedExtension('.avif', ['.png'])).toBe(false)
    })

    it('accepts an unlisted extension when the allowlist carries the wildcard', () => {
      expect(isSupportedExtension('.avif', ['.png', anyFileExt])).toBe(true)
    })

    it('rejects an extensionless name without the wildcard', () => {
      expect(isSupportedExtension('.', ['.png'])).toBe(false)
    })
  })
})
