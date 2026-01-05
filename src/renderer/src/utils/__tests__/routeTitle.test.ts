import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock i18n before importing the module
vi.mock('@renderer/i18n', () => ({
  default: {
    t: vi.fn((key: string) => {
      const translations: Record<string, string> = {
        'title.home': '首页',
        'common.chat': '聊天',
        'title.store': '助手库',
        'title.paintings': '绘画',
        'title.translate': '翻译',
        'title.apps': '小程序',
        'title.knowledge': '知识库',
        'title.files': '文件',
        'title.code': 'Code',
        'title.notes': '笔记',
        'title.settings': '设置'
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
        ['/', '首页'],
        ['/home', '首页'],
        ['/app/chat', '聊天'],
        ['/app/assistant', '助手库'],
        ['/app/paintings', '绘画'],
        ['/app/translate', '翻译'],
        ['/app/minapp', '小程序'],
        ['/app/knowledge', '知识库'],
        ['/app/files', '文件'],
        ['/app/code', 'Code'],
        ['/app/notes', '笔记'],
        ['/settings', '设置']
      ])('should return correct title for %s', (url, expectedTitle) => {
        expect(getDefaultRouteTitle(url)).toBe(expectedTitle)
      })
    })

    describe('nested route matches', () => {
      it('should match base path for nested routes', () => {
        expect(getDefaultRouteTitle('/app/chat/topic-123')).toBe('聊天')
        expect(getDefaultRouteTitle('/settings/provider')).toBe('设置')
        expect(getDefaultRouteTitle('/settings/mcp/servers')).toBe('设置')
        expect(getDefaultRouteTitle('/app/paintings/zhipu')).toBe('绘画')
      })
    })

    describe('URL with query params and hash', () => {
      it('should handle URLs with query parameters', () => {
        expect(getDefaultRouteTitle('/app/chat?topicId=123')).toBe('聊天')
        expect(getDefaultRouteTitle('/settings/provider?id=openai')).toBe('设置')
      })

      it('should handle URLs with hash', () => {
        expect(getDefaultRouteTitle('/app/knowledge#section1')).toBe('知识库')
      })

      it('should handle URLs with both query and hash', () => {
        expect(getDefaultRouteTitle('/app/chat?id=1#message-5')).toBe('聊天')
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
        expect(getDefaultRouteTitle('/app/chat/')).toBe('聊天')
        expect(getDefaultRouteTitle('/settings/')).toBe('设置')
      })

      it('should handle double slashes (protocol-relative URL)', () => {
        // '//chat' is a protocol-relative URL, so 'chat' becomes the hostname
        // This is expected behavior per URL standard
        expect(getDefaultRouteTitle('//chat')).toBe('首页')
      })

      it('should handle relative-like paths', () => {
        // URL constructor with base will normalize these
        expect(getDefaultRouteTitle('app/chat')).toBe('聊天')
        expect(getDefaultRouteTitle('./app/chat')).toBe('聊天')
      })
    })
  })

  describe('getRouteTitleKey', () => {
    describe('exact matches', () => {
      it.each([
        ['/', 'title.home'],
        ['/app/chat', 'common.chat'],
        ['/app/assistant', 'title.store'],
        ['/settings', 'title.settings']
      ])('should return i18n key for %s', (url, expectedKey) => {
        expect(getRouteTitleKey(url)).toBe(expectedKey)
      })
    })

    describe('base path matches', () => {
      it('should return base path key for nested routes', () => {
        expect(getRouteTitleKey('/app/chat/topic-123')).toBe('common.chat')
        expect(getRouteTitleKey('/settings/provider')).toBe('title.settings')
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
