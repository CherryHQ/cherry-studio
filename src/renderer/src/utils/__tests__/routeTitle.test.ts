import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock i18n before importing the module
vi.mock('@renderer/i18n', () => ({
  default: {
    t: vi.fn((key: string) => {
      const translations: Record<string, string> = {
        'tab.new': '新标签页',
        'assistants.title': '助手',
        'assistants.presets.title': '预设助手',
        'paintings.title': '绘图',
        'translate.title': '翻译',
        'minapp.title': '小程序',
        'knowledge.title': '知识库',
        'files.title': '文件',
        'code.title': '代码',
        'notes.title': '笔记',
        'settings.title': '设置'
      }
      return translations[key] || key
    })
  }
}))

import { getDefaultRouteTitle, getRouteTitleKey } from '../routeTitle'

describe('routeTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getDefaultRouteTitle', () => {
    describe('exact route matches', () => {
      it.each([
        ['/', '新标签页'],
        ['/chat', '助手'],
        ['/store', '预设助手'],
        ['/paintings', '绘图'],
        ['/translate', '翻译'],
        ['/apps', '小程序'],
        ['/knowledge', '知识库'],
        ['/files', '文件'],
        ['/code', '代码'],
        ['/notes', '笔记'],
        ['/settings', '设置']
      ])('should return correct title for %s', (url, expectedTitle) => {
        expect(getDefaultRouteTitle(url)).toBe(expectedTitle)
      })
    })

    describe('nested route matches', () => {
      it('should match base path for nested routes', () => {
        expect(getDefaultRouteTitle('/chat/topic-123')).toBe('助手')
        expect(getDefaultRouteTitle('/settings/provider')).toBe('设置')
        expect(getDefaultRouteTitle('/settings/mcp/servers')).toBe('设置')
        expect(getDefaultRouteTitle('/paintings/zhipu')).toBe('绘图')
      })
    })

    describe('URL with query params and hash', () => {
      it('should handle URLs with query parameters', () => {
        expect(getDefaultRouteTitle('/chat?topicId=123')).toBe('助手')
        expect(getDefaultRouteTitle('/settings/provider?id=openai')).toBe('设置')
      })

      it('should handle URLs with hash', () => {
        expect(getDefaultRouteTitle('/knowledge#section1')).toBe('知识库')
      })

      it('should handle URLs with both query and hash', () => {
        expect(getDefaultRouteTitle('/chat?id=1#message-5')).toBe('助手')
      })
    })

    describe('unknown routes', () => {
      it('should return last segment for unknown routes', () => {
        expect(getDefaultRouteTitle('/unknown')).toBe('unknown')
        expect(getDefaultRouteTitle('/foo/bar/baz')).toBe('baz')
      })

      it('should return pathname for root-like unknown routes', () => {
        expect(getDefaultRouteTitle('/x')).toBe('x')
      })
    })

    describe('edge cases', () => {
      it('should handle trailing slashes', () => {
        expect(getDefaultRouteTitle('/chat/')).toBe('助手')
        expect(getDefaultRouteTitle('/settings/')).toBe('设置')
      })

      it('should handle double slashes (protocol-relative URL)', () => {
        // '//chat' is a protocol-relative URL, so 'chat' becomes the hostname
        // This is expected behavior per URL standard
        expect(getDefaultRouteTitle('//chat')).toBe('新标签页')
      })

      it('should handle relative-like paths', () => {
        // URL constructor with base will normalize these
        expect(getDefaultRouteTitle('chat')).toBe('助手')
        expect(getDefaultRouteTitle('./chat')).toBe('助手')
      })
    })
  })

  describe('getRouteTitleKey', () => {
    describe('exact matches', () => {
      it.each([
        ['/', 'tab.new'],
        ['/chat', 'assistants.title'],
        ['/store', 'assistants.presets.title'],
        ['/settings', 'settings.title']
      ])('should return i18n key for %s', (url, expectedKey) => {
        expect(getRouteTitleKey(url)).toBe(expectedKey)
      })
    })

    describe('base path matches', () => {
      it('should return base path key for nested routes', () => {
        expect(getRouteTitleKey('/chat/topic-123')).toBe('assistants.title')
        expect(getRouteTitleKey('/settings/provider')).toBe('settings.title')
      })
    })

    describe('unknown routes', () => {
      it('should return undefined for unknown routes', () => {
        expect(getRouteTitleKey('/unknown')).toBeUndefined()
        expect(getRouteTitleKey('/foo/bar')).toBeUndefined()
      })
    })
  })
})
