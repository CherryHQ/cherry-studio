import type { SendMessageShortcut } from '@renderer/store/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatShortcut, getFilesFromDropEvent, getSendMessageShortcutLabel, isSendMessageKeyPressed } from '../input'

// Mock 外部依赖
vi.mock('@renderer/config/logger', () => ({
  default: { error: vi.fn() }
}))

// Mock constant with writable properties for testing
const mockConstants = {
  isMac: false,
  isWin: true
}

vi.mock('@renderer/config/constant', () => ({
  get isMac() {
    return mockConstants.isMac
  },
  get isWin() {
    return mockConstants.isWin
  }
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

  describe('getSendMessageShortcutLabel', () => {
    // 核心功能：快捷键标签转换
    it('should return correct labels for shortcuts in Windows environment', () => {
      expect(getSendMessageShortcutLabel('Enter')).toBe('Enter')
      expect(getSendMessageShortcutLabel('Ctrl+Enter')).toBe('Ctrl + Enter')
      expect(getSendMessageShortcutLabel('Command+Enter')).toBe('Win + Enter') // Windows 环境特殊处理
      expect(getSendMessageShortcutLabel('Custom+Enter' as SendMessageShortcut)).toBe('Custom+Enter') // 未知快捷键保持原样
    })
  })

  describe('isSendMessageKeyPressed', () => {
    // 核心功能：检测正确的快捷键组合
    it('should correctly detect each shortcut combination', () => {
      // 单独 Enter 键
      expect(
        isSendMessageKeyPressed(
          { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false } as any,
          'Enter'
        )
      ).toBe(true)

      // 组合键 - 每个快捷键只需一个有效案例
      expect(
        isSendMessageKeyPressed(
          { key: 'Enter', shiftKey: false, ctrlKey: true, metaKey: false, altKey: false } as any,
          'Ctrl+Enter'
        )
      ).toBe(true)

      expect(
        isSendMessageKeyPressed(
          { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: true, altKey: false } as any,
          'Command+Enter'
        )
      ).toBe(true)
    })

    // 边界情况：确保快捷键互斥
    it('should require exact modifier key combination', () => {
      const multiModifierEvent = {
        key: 'Enter',
        shiftKey: true,
        ctrlKey: true,
        metaKey: false,
        altKey: false
      } as React.KeyboardEvent<HTMLTextAreaElement>

      // 多个修饰键时，任何快捷键都不应触发
      expect(isSendMessageKeyPressed(multiModifierEvent, 'Enter')).toBe(false)
      expect(isSendMessageKeyPressed(multiModifierEvent, 'Ctrl+Enter')).toBe(false)
      expect(isSendMessageKeyPressed(multiModifierEvent, 'Shift+Enter')).toBe(false)
    })
  })

  describe('formatShortcut', () => {
    beforeEach(() => {
      // Reset to Windows by default
      mockConstants.isMac = false
      mockConstants.isWin = true
    })

    describe('modifier keys on Mac', () => {
      beforeEach(() => {
        mockConstants.isMac = true
        mockConstants.isWin = false
      })

      it('should format CommandOrControl as ⌘ on Mac', () => {
        expect(formatShortcut(['CommandOrControl'])).toBe('⌘')
      })

      it('should format Ctrl as ⌃ on Mac', () => {
        expect(formatShortcut(['Ctrl'])).toBe('⌃')
      })

      it('should format Alt as ⌥ on Mac', () => {
        expect(formatShortcut(['Alt'])).toBe('⌥')
      })

      it('should format Meta as ⌘ on Mac', () => {
        expect(formatShortcut(['Meta'])).toBe('⌘')
      })

      it('should format Shift as ⇧ on Mac', () => {
        expect(formatShortcut(['Shift'])).toBe('⇧')
      })

      it('should format Command as ⌘ on Mac (backward compatibility)', () => {
        expect(formatShortcut(['Command'])).toBe('⌘')
      })

      it('should format Cmd as ⌘ on Mac (backward compatibility)', () => {
        expect(formatShortcut(['Cmd'])).toBe('⌘')
      })

      it('should format Control as ⌃ on Mac (backward compatibility)', () => {
        expect(formatShortcut(['Control'])).toBe('⌃')
      })
    })

    describe('modifier keys on Windows', () => {
      beforeEach(() => {
        mockConstants.isMac = false
        mockConstants.isWin = true
      })

      it('should format CommandOrControl as Ctrl on Windows', () => {
        expect(formatShortcut(['CommandOrControl'])).toBe('Ctrl')
      })

      it('should format Ctrl as Ctrl on Windows', () => {
        expect(formatShortcut(['Ctrl'])).toBe('Ctrl')
      })

      it('should format Alt as Alt on Windows', () => {
        expect(formatShortcut(['Alt'])).toBe('Alt')
      })

      it('should format Meta as Win on Windows', () => {
        expect(formatShortcut(['Meta'])).toBe('Win')
      })

      it('should format Shift as Shift on Windows', () => {
        expect(formatShortcut(['Shift'])).toBe('Shift')
      })

      it('should format Command as Ctrl on Windows (backward compatibility)', () => {
        expect(formatShortcut(['Command'])).toBe('Ctrl')
      })

      it('should format Cmd as Ctrl on Windows (backward compatibility)', () => {
        expect(formatShortcut(['Cmd'])).toBe('Ctrl')
      })

      it('should format Control as Ctrl on Windows (backward compatibility)', () => {
        expect(formatShortcut(['Control'])).toBe('Ctrl')
      })
    })

    describe('modifier keys on Linux', () => {
      beforeEach(() => {
        mockConstants.isMac = false
        mockConstants.isWin = false
      })

      it('should format Meta as Super on Linux', () => {
        expect(formatShortcut(['Meta'])).toBe('Super')
      })

      it('should format CommandOrControl as Ctrl on Linux', () => {
        expect(formatShortcut(['CommandOrControl'])).toBe('Ctrl')
      })
    })

    describe('arrow keys', () => {
      it('should format ArrowUp as ↑', () => {
        expect(formatShortcut(['ArrowUp'])).toBe('↑')
      })

      it('should format ArrowDown as ↓', () => {
        expect(formatShortcut(['ArrowDown'])).toBe('↓')
      })

      it('should format ArrowLeft as ←', () => {
        expect(formatShortcut(['ArrowLeft'])).toBe('←')
      })

      it('should format ArrowRight as →', () => {
        expect(formatShortcut(['ArrowRight'])).toBe('→')
      })
    })

    describe('special keys', () => {
      it('should format Slash as /', () => {
        expect(formatShortcut(['Slash'])).toBe('/')
      })

      it('should format Semicolon as ;', () => {
        expect(formatShortcut(['Semicolon'])).toBe(';')
      })

      it('should format BracketLeft as [', () => {
        expect(formatShortcut(['BracketLeft'])).toBe('[')
      })

      it('should format BracketRight as ]', () => {
        expect(formatShortcut(['BracketRight'])).toBe(']')
      })

      it('should format Backslash as \\', () => {
        expect(formatShortcut(['Backslash'])).toBe('\\')
      })

      it("should format Quote as '", () => {
        expect(formatShortcut(['Quote'])).toBe("'")
      })

      it('should format Comma as ,', () => {
        expect(formatShortcut(['Comma'])).toBe(',')
      })

      it('should format Minus as -', () => {
        expect(formatShortcut(['Minus'])).toBe('-')
      })

      it('should format Equal as =', () => {
        expect(formatShortcut(['Equal'])).toBe('=')
      })
    })

    describe('regular keys (default case)', () => {
      it('should capitalize first letter of regular keys', () => {
        expect(formatShortcut(['enter'])).toBe('Enter')
        expect(formatShortcut(['escape'])).toBe('Escape')
        expect(formatShortcut(['tab'])).toBe('Tab')
        expect(formatShortcut(['a'])).toBe('A')
        expect(formatShortcut(['f'])).toBe('F')
      })

      it('should handle keys that are already capitalized', () => {
        expect(formatShortcut(['Enter'])).toBe('Enter')
        expect(formatShortcut(['Escape'])).toBe('Escape')
      })
    })

    describe('key combinations', () => {
      beforeEach(() => {
        mockConstants.isMac = true
        mockConstants.isWin = false
      })

      it('should join multiple keys with + on Mac', () => {
        expect(formatShortcut(['CommandOrControl', 'Shift', 'F'])).toBe('⌘ + ⇧ + F')
        expect(formatShortcut(['Ctrl', 'Alt', 'Delete'])).toBe('⌃ + ⌥ + Delete')
        expect(formatShortcut(['Command', 'K'])).toBe('⌘ + K')
      })

      it('should join multiple keys with + on Windows', () => {
        mockConstants.isMac = false
        mockConstants.isWin = true

        expect(formatShortcut(['CommandOrControl', 'Shift', 'F'])).toBe('Ctrl + Shift + F')
        expect(formatShortcut(['Ctrl', 'Alt', 'Delete'])).toBe('Ctrl + Alt + Delete')
        expect(formatShortcut(['Command', 'K'])).toBe('Ctrl + K')
      })

      it('should handle complex combinations with special keys', () => {
        mockConstants.isMac = true
        mockConstants.isWin = false

        expect(formatShortcut(['CommandOrControl', 'ArrowUp'])).toBe('⌘ + ↑')
        expect(formatShortcut(['Alt', 'BracketLeft'])).toBe('⌥ + [')
        expect(formatShortcut(['Shift', 'Slash'])).toBe('⇧ + /')
      })
    })

    describe('edge cases', () => {
      it('should handle empty array', () => {
        expect(formatShortcut([])).toBe('')
      })

      it('should handle single key', () => {
        expect(formatShortcut(['Enter'])).toBe('Enter')
      })

      it('should handle mixed case keys', () => {
        // The function only capitalizes the first letter of the key
        // For keys like 'SHIFT', it will keep them as 'SHIFT' since it doesn't match the switch cases
        mockConstants.isMac = false
        mockConstants.isWin = true
        expect(formatShortcut(['ctrl', 'Shift', 'f'])).toBe('Ctrl + Shift + F')
      })
    })
  })
})
