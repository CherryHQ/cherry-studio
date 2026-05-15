import type { Topic } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
import type { PropsWithChildren, ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import Chat from '../Chat'

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'chat.message.style') return ['message-style']
    if (key === 'ui.navbar.position') return [true]

    return [undefined, vi.fn()]
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/chat', () => ({
  OverlayHost: ({ children }: PropsWithChildren) => <div>{children}</div>,
  ChatAppShell: ({
    topBar,
    sidePanel,
    centerContent,
    main,
    bottomComposer,
    overlay
  }: {
    topBar?: ReactNode
    sidePanel?: ReactNode
    centerContent?: ReactNode
    main: ReactNode
    bottomComposer?: ReactNode
    overlay?: ReactNode
  }) => (
    <div>
      <div data-testid="chat-top-bar">{topBar}</div>
      <div data-testid="chat-side-panel">{sidePanel}</div>
      <div>{centerContent}</div>
      <div>{main}</div>
      <div>{bottomComposer}</div>
      <div>{overlay}</div>
    </div>
  )
}))

vi.mock('@renderer/components/ContentSearch', () => ({
  ContentSearch: () => <div data-testid="content-search" />
}))

vi.mock('@renderer/components/Popups/PromptPopup', () => ({
  default: { show: vi.fn() }
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/hooks/useShortcuts', () => ({
  useShortcut: vi.fn()
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: vi.fn() })
}))

vi.mock('@renderer/hooks/useTopicDataApi', () => ({
  useTopicMutations: () => ({ updateTopic: vi.fn() })
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: { SHOW_TOPIC_SIDEBAR: 'SHOW_TOPIC_SIDEBAR' },
  EventEmitter: { emit: vi.fn() }
}))

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn()
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../components/ChatNavBar', () => ({
  default: ({ onOpenSettings }: { onOpenSettings: () => void }) => (
    <button type="button" onClick={onOpenSettings}>
      open settings
    </button>
  )
}))

vi.mock('../ChatContent', () => ({
  default: ({
    onOpenCitationsPanel,
    renderFrame
  }: {
    onOpenCitationsPanel: (payload: { citations: unknown[] }) => void
    renderFrame: (frame: { main: ReactNode; bottomComposer: ReactNode; overlay: ReactNode }) => ReactNode
  }) => (
    <>
      <button type="button" onClick={() => onOpenCitationsPanel({ citations: [{ number: 1 }] })}>
        open citations
      </button>
      {renderFrame({
        main: <div data-testid="chat-main" />,
        bottomComposer: <div data-testid="chat-composer" />,
        overlay: <div data-testid="chat-overlay" />
      })}
    </>
  )
}))

vi.mock('../../chat-settings/SettingsPanel', () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) => (
    <div data-testid="settings-panel" data-open={String(open)}>
      {open && (
        <button type="button" onClick={onClose}>
          close settings
        </button>
      )}
    </div>
  )
}))

vi.mock('../../chat-citations/CitationsPanel', () => ({
  default: ({ open, onClose, citations }: { open: boolean; onClose: () => void; citations: unknown[] }) => (
    <div data-testid="citations-panel" data-open={String(open)} data-count={citations.length}>
      {open && (
        <button type="button" onClick={onClose}>
          close citations
        </button>
      )}
    </div>
  )
}))

describe('Chat settings panel', () => {
  it('keeps the settings panel open when the settings button is clicked repeatedly', () => {
    const activeTopic: Topic = {
      id: 'topic-1',
      name: 'Topic',
      assistantId: 'assistant-1',
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
      messages: []
    }

    render(<Chat activeTopic={activeTopic} setActiveTopic={vi.fn()} />)

    expect(screen.getByTestId('settings-panel')).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'open settings' }))
    expect(screen.getByTestId('settings-panel')).toHaveAttribute('data-open', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'open settings' }))
    expect(screen.getByTestId('settings-panel')).toHaveAttribute('data-open', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'close settings' }))
    expect(screen.getByTestId('settings-panel')).toHaveAttribute('data-open', 'false')
  })

  it('keeps settings and citations panels mutually exclusive', () => {
    const activeTopic: Topic = {
      id: 'topic-1',
      name: 'Topic',
      assistantId: 'assistant-1',
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
      messages: []
    }

    render(<Chat activeTopic={activeTopic} setActiveTopic={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'open settings' }))
    expect(screen.getByTestId('settings-panel')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'open citations' }))
    expect(screen.getByTestId('settings-panel')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-count', '1')

    fireEvent.click(screen.getByRole('button', { name: 'open settings' }))
    expect(screen.getByTestId('settings-panel')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-open', 'false')
  })
})
