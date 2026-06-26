import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock i18n before importing the module
vi.mock('@renderer/i18n', () => ({
  default: {
    t: vi.fn((key: string) => {
      const translations: Record<string, string> = {
        'common.chat': '聊天',
        'agent.session.group.conversation': '对话',
        'agent.sidebar_title': '任务',
        'title.store': '资源',
        'title.work': '工作',
        'title.paintings': '绘画',
        'title.translate': '翻译',
        'title.apps': '小程序',
        'title.knowledge': '知识库',
        'title.files': '文件',
        'title.code': 'Code',
        'title.notes': '笔记',
        'title.openclaw': 'OpenClaw',
        'title.settings': '设置'
      }
      return translations[key] || key
    })
  }
}))

import {
  getDefaultRouteTitle,
  getRouteTitleKey,
  isPageTitledRoute,
  isTopLevelRoute,
  shouldAutoLocalizeRouteTitle
} from '../routeTitle'

describe('routeTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getDefaultRouteTitle', () => {
    describe('exact route matches', () => {
      it.each([
        ['/app/chat', '对话'],
        ['/app/agents', '工作'],
        ['/app/paintings', '绘画'],
        ['/app/translate', '翻译'],
        ['/app/mini-app', '小程序'],
        ['/app/knowledge', '知识库'],
        ['/app/files', '文件'],
        ['/app/code', 'Code'],
        ['/app/notes', '笔记'],
        ['/app/openclaw', 'OpenClaw'],
        ['/settings', '设置']
      ])('should return correct title for %s', (url, expectedTitle) => {
        expect(getDefaultRouteTitle(url)).toBe(expectedTitle)
      })
    })

    describe('nested route matches', () => {
      it('should match base path for nested routes', () => {
        expect(getDefaultRouteTitle('/app/chat/topic-123')).toBe('对话')
        expect(getDefaultRouteTitle('/app/agents/session-123')).toBe('工作')
        expect(getDefaultRouteTitle('/settings/provider')).toBe('设置')
        expect(getDefaultRouteTitle('/settings/mcp/servers')).toBe('设置')
        expect(getDefaultRouteTitle('/app/paintings/zhipu')).toBe('绘画')
      })
    })

    describe('URL with query params and hash', () => {
      it('should handle URLs with query parameters', () => {
        expect(getDefaultRouteTitle('/app/chat?topicId=123')).toBe('对话')
        expect(getDefaultRouteTitle('/settings/provider?id=openai')).toBe('设置')
      })

      it('should handle URLs with hash', () => {
        expect(getDefaultRouteTitle('/app/knowledge#section1')).toBe('知识库')
      })

      it('should handle URLs with both query and hash', () => {
        expect(getDefaultRouteTitle('/app/chat?id=1#message-5')).toBe('对话')
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
        expect(getDefaultRouteTitle('/app/chat/')).toBe('对话')
        expect(getDefaultRouteTitle('/settings/')).toBe('设置')
      })

      it('should handle double slashes (protocol-relative URL)', () => {
        // '//chat' is a protocol-relative URL, so 'chat' becomes the hostname
        // This is expected behavior per URL standard
        expect(getDefaultRouteTitle('//chat')).toBe('/')
      })

      it('should handle relative-like paths', () => {
        // URL constructor with base will normalize these
        expect(getDefaultRouteTitle('app/chat')).toBe('对话')
        expect(getDefaultRouteTitle('./app/chat')).toBe('对话')
      })
    })
  })

  describe('getRouteTitleKey', () => {
    describe('exact matches', () => {
      it.each([
        ['/app/chat', 'agent.session.group.conversation'],
        ['/app/agents', 'title.work'],
        ['/app/openclaw', 'title.openclaw'],
        ['/settings', 'title.settings']
      ])('should return i18n key for %s', (url, expectedKey) => {
        expect(getRouteTitleKey(url)).toBe(expectedKey)
      })
    })

    describe('base path matches', () => {
      it('should return base path key for nested routes', () => {
        expect(getRouteTitleKey('/app/chat/topic-123')).toBe('agent.session.group.conversation')
        expect(getRouteTitleKey('/app/agents/session-123')).toBe('title.work')
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

  describe('isTopLevelRoute', () => {
    it('returns true only for bare top-level route tabs', () => {
      expect(isTopLevelRoute('/app/chat')).toBe(true)
      expect(isTopLevelRoute('/app/agents')).toBe(true)
      expect(isTopLevelRoute('/app/chat?topicId=123&view=message')).toBe(false)
      expect(isTopLevelRoute('/app/agents#session')).toBe(false)
      expect(isTopLevelRoute('/app/chat/topic-123')).toBe(false)
    })
  })

  describe('isPageTitledRoute', () => {
    it('treats chat/agent routes as page-titled regardless of query/sub-path', () => {
      expect(isPageTitledRoute('/app/chat')).toBe(true)
      expect(isPageTitledRoute('/app/chat?topicId=123')).toBe(true)
      expect(isPageTitledRoute('/app/agents')).toBe(true)
      expect(isPageTitledRoute('/app/agents?sessionId=abc')).toBe(true)
    })

    it('treats route-titled apps as not page-titled', () => {
      expect(isPageTitledRoute('/app/files')).toBe(false)
      expect(isPageTitledRoute('/app/paintings/zhipu')).toBe(false)
      expect(isPageTitledRoute('/settings')).toBe(false)
    })
  })

  describe('shouldAutoLocalizeRouteTitle', () => {
    it.each([
      // Top-level routes always re-localize.
      ['/app/chat', true],
      ['/settings', true],
      ['/app/paintings', true],
      // Paintings sub-routes inherit the section title (splat route, no per-entity title).
      ['/app/paintings/zhipu', true],
      // Any /settings sub-route re-localizes.
      ['/settings/provider/openai', true],
      // mini-app and chat sub-routes preserve caller-supplied per-entity titles.
      ['/app/mini-app/weather', false],
      ['/app/chat/123', false],
      // Unknown routes are not auto-localized.
      ['/unknown', false]
    ])('should return %s -> %s', (url, expected) => {
      expect(shouldAutoLocalizeRouteTitle(url)).toBe(expected)
    })
  })
})
