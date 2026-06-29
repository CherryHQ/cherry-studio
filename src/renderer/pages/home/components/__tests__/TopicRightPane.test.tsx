import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TopicRightPane } from '../TopicRightPane'

const developerModeEnabled = vi.fn(() => true)

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) =>
    key === 'app.developer_mode.enabled' ? [developerModeEnabled(), vi.fn()] : [undefined, vi.fn()]
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal()),
  Button: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tabs: ({ children }: PropsWithChildren) => <div>{children}</div>,
  TabsContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  TabsList: ({ children }: PropsWithChildren) => <div>{children}</div>,
  TabsTrigger: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: PropsWithChildren) => children
}))

vi.mock('@renderer/components/chat/shell/RightPaneHost', async () => {
  const React = await import('react')

  return {
    ARTIFACT_RIGHT_PANE_CACHE_KEY: 'ui.chat.artifact_pane.width',
    ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH: 460,
    ARTIFACT_RIGHT_PANE_MAX_WIDTH: 720,
    ARTIFACT_RIGHT_PANE_MIN_WIDTH: 360,
    RightPaneHost: ({
      children,
      onCloseAnimationComplete,
      open
    }: PropsWithChildren<{ onCloseAnimationComplete?: () => void; open?: boolean }>) => {
      React.useEffect(() => {
        if (!open) onCloseAnimationComplete?.()
      }, [onCloseAnimationComplete, open])

      return (
        <section data-testid="right-pane" data-open={String(Boolean(open))}>
          {open ? children : null}
        </section>
      )
    }
  }
})

vi.mock('@renderer/components/chat/trace/TracePane', () => ({
  TracePane: ({ payload }: { payload: { topicId: string; traceId: string } | null }) => (
    <div data-testid="trace-pane" data-topic-id={payload?.topicId} data-trace-id={payload?.traceId} />
  )
}))

vi.mock('../TopicBranchPanel', () => ({
  default: ({ onLocateMessage }: { onLocateMessage?: (messageId: string) => void }) => (
    <button type="button" data-testid="branch-pane" onClick={() => onLocateMessage?.('message-1')}>
      locate current branch message
    </button>
  )
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('TopicRightPane', () => {
  beforeEach(() => {
    developerModeEnabled.mockReturnValue(true)
  })

  it('shows a permanent trace tab keyed on the container traceId when developer mode is on', () => {
    render(
      <TopicRightPane>
        <TopicRightPane.Toggle />
        <TopicRightPane.Host topicId="topic-a" traceId="trace-a" />
      </TopicRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.open_sidebar' }))

    expect(screen.getByRole('button', { name: /trace\.label/ })).toBeInTheDocument()
    expect(screen.getByTestId('trace-pane')).toHaveAttribute('data-topic-id', 'topic-a')
    expect(screen.getByTestId('trace-pane')).toHaveAttribute('data-trace-id', 'trace-a')
  })

  it('hides the trace tab when developer mode is off', () => {
    developerModeEnabled.mockReturnValue(false)

    render(
      <TopicRightPane>
        <TopicRightPane.Toggle />
        <TopicRightPane.Host topicId="topic-a" traceId="trace-a" />
      </TopicRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.open_sidebar' }))

    expect(screen.queryByRole('button', { name: /trace\.label/ })).toBeNull()
    expect(screen.queryByTestId('trace-pane')).toBeNull()
    expect(screen.getByTestId('branch-pane')).toBeInTheDocument()
  })

  it('forwards branch-node locate requests without closing the shell', async () => {
    const onLocateMessage = vi.fn()

    render(
      <TopicRightPane>
        <TopicRightPane.Toggle />
        <TopicRightPane.Host topicId="topic-1" topicName="Topic" onLocateMessage={onLocateMessage} />
      </TopicRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.open_sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'locate current branch message' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')

    await waitFor(() => {
      expect(onLocateMessage).toHaveBeenCalledWith('message-1')
    })
  })
})
