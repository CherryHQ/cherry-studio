import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerShortcut } from '@shared/data/preference/preferenceTypes'

import {
  getComposerShortcutLabel,
  getFilesFromDropEvent,
  matchesComposerShortcut,
  resolveNewlineShortcut,
  resolveSendShortcut,
  resolveSteerShortcut
} from '../input'

// Mock 外部依赖
vi.mock('@renderer/config/logger', () => ({
  default: { error: vi.fn() }
}))

vi.mock('@renderer/utils/platform', () => ({
  isMac: false,
  isWin: true
}))

// Mock window.api
const mockGetPathForFile = vi.fn()
const mockFileGet = vi.fn()

describe('input', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 设置 window.api mock
    global.window = {
      api: {
        file: {
          getPathForFile: mockGetPathForFile,
          get: mockFileGet
        }
      }
    } as any
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getFilesFromDropEvent', () => {
    // 核心功能：处理文件拖放
    it('should handle file drop with File objects', async () => {
      const mockFile1 = new File(['content1'], 'file1.txt')
      const mockFile2 = new File(['content2'], 'file2.txt')
      const mockMetadata1 = { id: '1', name: 'file1.txt', path: '/path/file1.txt' }
      const mockMetadata2 = { id: '2', name: 'file2.txt', path: '/path/file2.txt' }

      mockGetPathForFile.mockImplementation((file) => {
        if (file === mockFile1) return '/path/file1.txt'
        if (file === mockFile2) return '/path/file2.txt'
        return null
      })

      mockFileGet.mockImplementation((path) => {
        if (path === '/path/file1.txt') return mockMetadata1
        if (path === '/path/file2.txt') return mockMetadata2
        return null
      })

      const event = {
        dataTransfer: {
          files: [mockFile1, mockFile2],
          items: []
        }
      } as any

      const result = await getFilesFromDropEvent(event)
      expect(result).toEqual([mockMetadata1, mockMetadata2])
      expect(mockGetPathForFile).toHaveBeenCalledTimes(2)
      expect(mockFileGet).toHaveBeenCalledTimes(2)
    })

    // 处理 codefiles 格式
    it('should handle codefiles format from drag event', async () => {
      const mockMetadata = { id: '1', name: 'file.txt', path: '/path/file.txt' }
      mockFileGet.mockResolvedValue(mockMetadata)

      const mockGetAsString = vi.fn((callback) => {
        callback(JSON.stringify(['/path/file.txt']))
      })

      const event = {
        dataTransfer: {
          files: [],
          items: [
            {
              type: 'codefiles',
              getAsString: mockGetAsString
            }
          ]
        }
      } as any

      const result = await getFilesFromDropEvent(event)
      expect(result).toEqual([mockMetadata])
      expect(mockGetAsString).toHaveBeenCalled()
    })

    // 边界情况：空文件列表
    it('should return empty array when no files are dropped', async () => {
      const event = {
        dataTransfer: {
          files: [],
          items: []
        }
      } as any

      const result = await getFilesFromDropEvent(event)
      expect(result).toEqual([])
    })

    // 错误处理
    it('should handle errors gracefully when file path cannot be obtained', async () => {
      const mockFile = new File(['content'], 'file.txt')
      mockGetPathForFile.mockImplementation(() => {
        throw new Error('Path error')
      })

      const event = {
        dataTransfer: {
          files: [mockFile],
          items: []
        }
      } as any

      const result = await getFilesFromDropEvent(event)
      expect(result).toEqual([])
    })
  })

  describe('getComposerShortcutLabel', () => {
    it('formats bindings with the shared shortcut vocabulary', () => {
      expect(getComposerShortcutLabel(['Enter'])).toBe('Enter')
      // CommandOrControl renders as the platform key: Ctrl here, Command on macOS.
      expect(getComposerShortcutLabel(['CommandOrControl', 'Enter'])).toBe('Ctrl+Enter')
      expect(getComposerShortcutLabel(['Shift', 'Enter'])).toBe('Shift+Enter')
    })
  })

  describe('matchesComposerShortcut', () => {
    it('matches a binding against the pressed modifiers', () => {
      expect(matchesComposerShortcut({ key: 'Enter' }, ['Enter'])).toBe(true)
      expect(matchesComposerShortcut({ key: 'Enter', ctrlKey: true }, ['CommandOrControl', 'Enter'])).toBe(true)
      expect(matchesComposerShortcut({ key: 'Enter', shiftKey: true }, ['Shift', 'Enter'])).toBe(true)
    })

    it('requires the exact combination', () => {
      const shiftCtrlEnter = { key: 'Enter', shiftKey: true, ctrlKey: true }
      expect(matchesComposerShortcut(shiftCtrlEnter, ['Enter'])).toBe(false)
      expect(matchesComposerShortcut(shiftCtrlEnter, ['CommandOrControl', 'Enter'])).toBe(false)
      expect(matchesComposerShortcut(shiftCtrlEnter, ['Shift', 'Enter'])).toBe(false)
    })
  })

  describe('resolveComposerShortcuts', () => {
    it('reads the five legacy string values written before 2.0', () => {
      expect(resolveSendShortcut('Shift+Enter')).toEqual(['Shift', 'Enter'])
      // Off macOS Command+Enter was matched against the OS-reserved Meta key and could never
      // fire; it resolves to the platform modifier instead.
      expect(resolveSendShortcut('Command+Enter')).toEqual(['CommandOrControl', 'Enter'])
      expect(resolveSendShortcut('Ctrl+Enter')).toEqual(['CommandOrControl', 'Enter'])
      expect(resolveSendShortcut(undefined)).toEqual(['Enter'])
    })

    it('keeps send, newline, and steer on distinct keys', () => {
      const send = resolveSendShortcut(['Shift', 'Enter'])
      const newline = resolveNewlineShortcut(null, send)
      const steer = resolveSteerShortcut(null, send, newline)

      expect(newline).toEqual(['Enter'])
      expect(steer).toEqual(['CommandOrControl', 'Enter'])
    })

    it('drops a stored value that another role already took', () => {
      const send: ComposerShortcut = ['CommandOrControl', 'Enter']
      expect(resolveNewlineShortcut(['CommandOrControl', 'Enter'], send)).toEqual(['Shift', 'Enter'])
      // Its own preferred default is taken by send, so it falls to the first free combination.
      expect(resolveSteerShortcut(['Shift', 'Enter'], send, ['Shift', 'Enter'])).toEqual(['Enter'])
    })
  })
})
