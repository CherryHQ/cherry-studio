import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { type ComponentProps, useLayoutEffect } from 'react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryUi from '@cherrystudio/ui'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import { MessageReportArtifacts } from '@renderer/components/chat/messages/tools/agent/ReportArtifacts'
import { defaultMessageRenderConfig, type MessageListProviderValue } from '@renderer/components/chat/messages/types'
import { FileEditSessionProvider } from '@renderer/components/FileEditSessionProvider'
import enUs from '@renderer/i18n/locales/en-us.json'
import type { PhysicalFileMetadata } from '@shared/types/file'
import { TreeDirRoot } from '@shared/utils/file'

import { AgentRightPane, useAgentRightPaneActions } from '../components/AgentRightPane'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryUi>())

let fixtureRoot: string
let workspacePath: string
let artifactPath: string
let metadataGate: Promise<void> | undefined
let treePending: boolean
const treeActivated = vi.fn()

const messages: MessageListProviderValue['state']['messages'] = []
const partsByMessageId = {}

function ArtifactMessage({ onCommit }: { onCommit?: (disabled: string | null) => void }) {
  const { canOpenArtifactFile, openArtifactFile } = useAgentRightPaneActions()
  const value: MessageListProviderValue = {
    state: {
      topic: { id: 'agent-session:markdown' } as MessageListProviderValue['state']['topic'],
      messages,
      partsByMessageId,
      messageNavigation: 'none',
      estimateSize: 0,
      overscan: 0,
      loadOlderDelayMs: 0,
      loadingResetDelayMs: 0,
      renderConfig: defaultMessageRenderConfig
    },
    actions: { openArtifactFile: canOpenArtifactFile ? openArtifactFile : undefined },
    meta: { selectionLayer: false }
  }
  useLayoutEffect(() => {
    onCommit?.(screen.getByRole('button', { name: 'Preview brief.md' }).getAttribute('aria-disabled'))
  })
  return (
    <MessageListProvider value={value}>
      <MessageReportArtifacts
        toolResponses={[
          {
            id: 'report-brief',
            toolCallId: 'report-brief',
            tool: { id: 'report-artifacts', name: 'report_artifacts', type: 'builtin' },
            status: 'done',
            arguments: { artifacts: [{ path: artifactPath }] }
          }
        ]}
      />
    </MessageListProvider>
  )
}

type ConversationProps = Pick<ComponentProps<typeof AgentRightPane.Scope>, 'conversationState' | 'workspaceId'> & {
  onCommit?: (disabled: string | null) => void
}

function Conversation({ onCommit, ...props }: ConversationProps) {
  return (
    <FileEditSessionProvider>
      <AgentRightPane.Scope
        sessionId="markdown"
        workspaceId="system"
        workspacePath={workspacePath}
        workspaceType="system"
        messages={[]}
        partsByMessageId={partsByMessageId}
        resourcePane={{ node: <div>Resources</div>, label: 'Resources' }}
        {...props}>
        <ArtifactMessage onCommit={onCommit} />
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </AgentRightPane.Scope>
    </FileEditSessionProvider>
  )
}

const filesEntry = () => screen.queryByRole('button', { name: enUs['agent.right_pane.tabs.files'] })

async function expectMarkdownPreview() {
  const preview = await screen.findByTestId('artifact-file-preview-overlay')
  expect(await within(preview).findByRole('heading', { level: 1, name: 'Brief' })).toBeVisible()
  expect(within(preview).getByRole('listitem')).toHaveTextContent('Done')
  expect(within(preview).getByRole('listitem')).toBeVisible()
  expect(within(preview).queryByRole('textbox')).not.toBeInTheDocument()
  expect(preview.querySelector('[contenteditable="true"], textarea, input:not([readonly])')).toBeNull()
  return preview
}

describe('agent chat Markdown artifact in an empty SYSTEM workspace', () => {
  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(process.env.TMPDIR ?? process.cwd(), 'artifact-markdown-'))
    const outputs = join(fixtureRoot, 'outputs')
    mkdirSync(outputs)
    artifactPath = join(outputs, 'brief.md')
    writeFileSync(artifactPath, '# Brief\n\n- Done\n')
  })

  afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }))

  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    workspacePath = mkdtempSync(join(fixtureRoot, 'empty-system-'))
    metadataGate = undefined
    treePending = false
    treeActivated.mockClear()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('app.developer_mode.enabled', false)
    Object.assign(window.api, {
      fs: { readText: async (path: string) => readFileSync(path, 'utf8') }
    })
    vi.mocked(window.api.ipcApi.request).mockImplementation(async (route, input) => {
      if (route === 'file.get_metadata') {
        await metadataGate
        const { path } = input as { path: string }
        const stats = statSync(path)
        expect(stats.isFile()).toBe(true)
        const metadata = {
          kind: 'file',
          type: 'text',
          size: stats.size,
          createdAt: stats.birthtimeMs,
          modifiedAt: stats.mtimeMs,
          mime: 'text/markdown'
        } satisfies PhysicalFileMetadata
        return { ok: true, data: metadata }
      }
      if (route === 'file.tree.create') {
        if (treePending) return new Promise(() => {})
        const { rootPath } = input as { rootPath: string }
        expect(readdirSync(rootPath)).toEqual([])
        return { ok: true, data: { treeId: rootPath, revision: 0, snapshot: new TreeDirRoot(rootPath).toJSON() } }
      }
      if (route === 'file.tree.activate') {
        treeActivated()
        return { ok: true, data: true }
      }
      return { ok: true, data: undefined }
    })
  })

  it('renders the file from the real card and hides Files again after clearing selection', async () => {
    const user = userEvent.setup()
    render(<Conversation />)
    await waitFor(() => expect(treeActivated).toHaveBeenCalled())
    expect(filesEntry()).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview brief.md' })).toHaveAttribute('aria-disabled', 'false')
    await user.click(screen.getByRole('button', { name: 'Preview brief.md' }))
    await expectMarkdownPreview()
    expect(filesEntry()).toBeVisible()
    await user.click(screen.getByRole('button', { name: enUs['common.back'] }))
    await waitFor(() => expect(filesEntry()).not.toBeInTheDocument())
    expect(screen.queryByTestId('artifact-file-preview-overlay')).not.toBeInTheDocument()
  })

  it('waits for delayed metadata with an unloaded tree and a ready fallback panel', async () => {
    treePending = true
    const metadata = Promise.withResolvers<void>()
    metadataGate = metadata.promise
    const user = userEvent.setup()
    render(<Conversation />)
    expect(filesEntry()).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview brief.md' }))
    expect(screen.queryByRole('heading', { level: 1, name: 'Brief' })).not.toBeInTheDocument()
    await act(async () => metadata.resolve())
    await expectMarkdownPreview()
  })

  it('opens the same historical card after the conversation remounts', async () => {
    const user = userEvent.setup()
    const first = render(<Conversation />)
    await user.click(screen.getByRole('button', { name: 'Preview brief.md' }))
    await expectMarkdownPreview()
    first.unmount()
    render(<Conversation />)
    expect(filesEntry()).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview brief.md' }))
    await expectMarkdownPreview()
  })

  it.each(['pending', 'unavailable'] as const)('disables the card while the conversation is %s', async (state) => {
    const user = userEvent.setup()
    render(<Conversation conversationState={state} />)
    expect(screen.getByRole('button', { name: 'Preview brief.md' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('button', { name: 'Preview brief.md' }))
    expect(screen.queryByTestId('artifact-file-preview-overlay')).not.toBeInTheDocument()
    expect(filesEntry()).not.toBeInTheDocument()
  })

  it('disables the card until a changed workspace binding commits', () => {
    const view = render(<Conversation />)
    const committedStates: Array<string | null> = []
    view.rerender(<Conversation workspaceId="replacement" onCommit={(disabled) => committedStates.push(disabled)} />)
    expect(committedStates[0]).toBe('true')
    expect(screen.getByRole('button', { name: 'Preview brief.md' })).toHaveAttribute('aria-disabled', 'false')
    expect(filesEntry()).not.toBeInTheDocument()
  })
})
