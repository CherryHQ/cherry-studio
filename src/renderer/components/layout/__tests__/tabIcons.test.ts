import type { Tab } from '@renderer/hooks/useTabs'
import {
  FileSearch,
  Folder,
  Globe,
  LayoutGrid,
  Library,
  MessageCircle,
  MousePointerClick,
  NotepadText,
  Sparkle
} from 'lucide-react'
import { describe, expect, it } from 'vitest'

import { OpenClawSidebarIcon } from '../../Icons/SvgIcon'
import { getTabIcon } from '../tabIcons'

function routeTab(url: string): Tab {
  return {
    id: url,
    type: 'route',
    url,
    title: url
  }
}

function webviewTab(url: string): Tab {
  return {
    id: url,
    type: 'webview',
    url,
    title: url
  }
}

describe('getTabIcon', () => {
  it.each([
    ['/app/agents', MousePointerClick],
    ['/app/assistant', Sparkle],
    ['/app/knowledge', FileSearch],
    ['/app/files', Folder],
    ['/app/notes', NotepadText],
    ['/app/openclaw', OpenClawSidebarIcon],
    ['/app/library', Library],
    ['/app/mini-app', LayoutGrid]
  ])('returns the shared app icon for %s', (url, Icon) => {
    expect(getTabIcon(routeTab(url))).toBe(Icon)
  })

  it('keeps webview tabs on the globe icon', () => {
    expect(getTabIcon(webviewTab('https://example.com'))).toBe(Globe)
  })

  it('keeps unknown routes on the message icon fallback', () => {
    expect(getTabIcon(routeTab('/unknown'))).toBe(MessageCircle)
  })
})
