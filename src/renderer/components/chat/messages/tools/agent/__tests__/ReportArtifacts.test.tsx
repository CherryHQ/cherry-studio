import type { NormalToolResponse } from '@renderer/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageListProvider } from '../../../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListProviderValue } from '../../../types'
import { setInlineFilePathHomePath } from '../../../utils/filePath'
import { MessageReportArtifacts } from '../ReportArtifacts'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'common.preview') return 'Preview'
      if (key === 'chat.input.tools.open_file') return 'Open File'
      if (key === 'chat.input.tools.open_file_error') return 'Failed to open file'
      return key
    }
  })
}))

vi.mock('@iconify/react', () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />
}))

const renderWithProvider = (ui: ReactElement, actions: MessageListProviderValue['actions'] = {}) => {
  const value: MessageListProviderValue = {
    state: {
      topic: { id: 'topic-1', name: 'Topic' } as MessageListProviderValue['state']['topic'],
      messages: [],
      partsByMessageId: {},
      messageNavigation: 'none',
      estimateSize: 0,
      overscan: 0,
      loadOlderDelayMs: 0,
      loadingResetDelayMs: 0,
      renderConfig: defaultMessageRenderConfig
    },
    actions,
    meta: { selectionLayer: false }
  }

  return render(<MessageListProvider value={value}>{ui}</MessageListProvider>)
}

describe('MessageReportArtifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setInlineFilePathHomePath(undefined)
  })

  it('renders declared deliverables from tool arguments', () => {
    renderWithProvider(
      <MessageReportArtifacts
        toolResponses={[
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'report-artifacts', name: 'report_artifacts', type: 'builtin' },
            status: 'done',
            arguments: {
              summary: 'Created final outputs',
              artifacts: [{ path: 'dist/report.md', description: 'Report' }]
            },
            response: 'Recorded 1 artifact(s).'
          } as NormalToolResponse
        ]}
      />
    )

    expect(screen.getByRole('button', { name: 'Preview report.md' })).toBeInTheDocument()
    expect(screen.getByText('report.md')).toBeInTheDocument()
    expect(screen.queryByText('Created final outputs')).toBeNull()
    expect(screen.queryByText('- Report')).toBeNull()
  })

  it('uses the latest declaration for duplicate artifact paths', () => {
    renderWithProvider(
      <MessageReportArtifacts
        toolResponses={[
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'report-artifacts', name: 'report_artifacts', type: 'builtin' },
            status: 'done',
            arguments: {
              summary: 'First summary',
              artifacts: [{ path: 'dist/report.md', description: 'Draft' }]
            }
          } as NormalToolResponse,
          {
            id: 'tool-call-2',
            toolCallId: 'tool-call-2',
            tool: { id: 'report-artifacts', name: 'report_artifacts', type: 'builtin' },
            status: 'done',
            arguments: {
              summary: 'Final summary',
              artifacts: [{ path: 'dist/report.md', description: 'Final report' }]
            }
          } as NormalToolResponse
        ]}
      />
    )

    expect(screen.getAllByRole('button', { name: 'Preview report.md' })).toHaveLength(1)
    expect(screen.queryByText('Final summary')).toBeNull()
    expect(screen.queryByText('- Final report')).toBeNull()
    expect(screen.queryByText('- Draft')).toBeNull()
  })

  it('previews on card click and opens externally from the side button', async () => {
    const openArtifactFile = vi.fn().mockResolvedValue(undefined)
    const openPath = vi.fn().mockResolvedValue(undefined)

    renderWithProvider(
      <MessageReportArtifacts
        toolResponses={[
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'report-artifacts', name: 'report_artifacts', type: 'builtin' },
            status: 'done',
            arguments: {
              artifacts: [{ path: 'dist/report.md' }]
            }
          } as NormalToolResponse
        ]}
      />,
      { openArtifactFile, openPath }
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview report.md' }))
    await waitFor(() => {
      expect(openArtifactFile).toHaveBeenCalledWith('dist/report.md')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open File report.md' }))
    await waitFor(() => {
      expect(openPath).toHaveBeenCalledWith('dist/report.md')
    })
  })

  it('resolves home-relative artifact paths before previewing or opening externally', async () => {
    const openArtifactFile = vi.fn().mockResolvedValue(undefined)
    const openPath = vi.fn().mockResolvedValue(undefined)
    setInlineFilePathHomePath('/Users/alice')

    renderWithProvider(
      <MessageReportArtifacts
        toolResponses={[
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'report-artifacts', name: 'report_artifacts', type: 'builtin' },
            status: 'done',
            arguments: {
              artifacts: [{ path: '~/Desktop/report.html' }]
            }
          } as NormalToolResponse
        ]}
      />,
      { openArtifactFile, openPath }
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview report.html' }))
    await waitFor(() => {
      expect(openArtifactFile).toHaveBeenCalledWith('/Users/alice/Desktop/report.html')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open File report.html' }))
    await waitFor(() => {
      expect(openPath).toHaveBeenCalledWith('/Users/alice/Desktop/report.html')
    })
  })
})
