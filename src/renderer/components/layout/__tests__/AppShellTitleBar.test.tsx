// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Tab } from '@renderer/hooks/tab'

vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    t: (key: string) =>
      ({
        'agent.session.group.conversation': '对话',
        'title.work': '工作'
      })[key] ?? key
  }
}))

vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => false
}))

vi.mock('@renderer/utils/platform', () => ({
  isMac: false
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../ShellTabBarActions', () => ({
  ShellTabBarActions: () => null
}))

vi.mock('../TabIcon', () => ({
  TabIcon: () => null
}))

import { AppShellTitleBar } from '../AppShellTitleBar'

const createTab = (url: string, title: string): Tab => ({
  id: 'active-tab',
  type: 'route',
  url,
  title
})

afterEach(cleanup)

describe('AppShellTitleBar', () => {
  it.each([
    ['/app/chat?topicId=topic-1', '季度规划', '对话'],
    ['/app/agents?sessionId=session-1', '发布助手会话', '工作']
  ])('shows the section title instead of the conversation title for %s', (url, conversationTitle, sectionTitle) => {
    render(
      <AppShellTitleBar
        activeTab={createTab(url, conversationTitle)}
        isFocused={false}
        isFullscreen={false}
        onBack={vi.fn()}
      />
    )

    expect(screen.getByText(sectionTitle)).toBeInTheDocument()
    expect(screen.queryByText(conversationTitle)).not.toBeInTheDocument()
  })

  it('keeps the tab title for other pages', () => {
    render(
      <AppShellTitleBar
        activeTab={createTab('/app/mini-app/weather', 'Weather')}
        isFocused={false}
        isFullscreen={false}
        onBack={vi.fn()}
      />
    )

    expect(screen.getByText('Weather')).toBeInTheDocument()
  })
})
