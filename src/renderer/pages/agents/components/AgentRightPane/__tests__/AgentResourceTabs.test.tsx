import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from 'i18next'
import { useState } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { ArtifactPaneFileSelection } from '@renderer/components/chat/panes/ArtifactPane'
import {
  RightPanelProvider,
  RightPanelShortcut,
  useRightPanelActions,
  type RightPanelCapability
} from '@renderer/components/chat/panes/Shell'
import { ShellExecutionActions } from '@renderer/components/terminal/ShellExecutionActions'
import { TerminalPane } from '@renderer/components/terminal/TerminalPane'
import {
  TerminalResourcesProvider,
  useTerminalResources
} from '@renderer/components/terminal/TerminalResourcesProvider'
import { toast } from '@renderer/services/toast'
import type { InputFor } from '@shared/ipc/types'
import type { TerminalResourceView } from '@shared/types/terminal'

import { AgentResourceHeaderProvider, AgentResourceTabs } from '../AgentResourceTabs'

vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/useCache')

const original: TerminalResourceView = {
  id: '11111111-1111-4111-8111-111111111111' as TerminalResourceView['id'],
  host: {
    conversationId: 'resource-tabs-test' as TerminalResourceView['host']['conversationId'],
    generation: '22222222-2222-4222-8222-222222222222' as TerminalResourceView['host']['generation']
  },
  kind: 'pty',
  shell: 'zsh',
  context: { contextId: 'runtime', bindingId: 'binding', revision: 0 },
  process: { kind: 'running' },
  cleanup: 'none',
  retention: { kind: 'session' },
  cancelRevision: 0,
  control: { kind: 'user' },
  controlRevision: 0,
  revision: 1,
  outputCursor: 0
}
let resources: TerminalResourceView[]
let requests: string[]
let recovered: boolean
let rejectCreation: boolean
let closeOutcome: 'confirmed' | 'unconfirmed' | 'rejected'
let stopWait: Promise<void> | undefined
let stopCalls: number
let stopCompleted: boolean
const record = {
  id: '33333333-3333-4333-8333-333333333333',
  sessionId: 'purged-conversation',
  cwd: '/retained/old-workspace',
  owner: { kind: 'terminal', resourceId: original.id, generation: '44444444-4444-4444-8444-444444444444' },
  createdAt: 1
}
beforeEach(() => {
  resources = [structuredClone(original)]
  requests = []
  recovered = false
  rejectCreation = false
  closeOutcome = 'confirmed'
  stopWait = undefined
  stopCalls = 0
  stopCompleted = false
  window.api.file.select = vi.fn().mockResolvedValue(null)
  window.api.ipcApi.request = vi.fn(async (route, payload) => {
    requests.push(route)
    if (route === 'terminal.list') return { ok: true, data: { resources, truncated: false } }
    if (route === 'terminal.cleanup.status')
      return { ok: true, data: { count: recovered ? 1 : 0, recoveryFailed: false } }
    if (route === 'terminal.cleanup.list') return { ok: true, data: recovered ? [record] : [] }
    if (route === 'terminal.cleanup.retry') {
      expect(payload).toEqual({ id: record.id })
      return { ok: true, data: { status: 'unavailable' } }
    }
    if (route === 'terminal.create' && rejectCreation) {
      expect(payload).toEqual({
        sessionId: 'resource-tabs-test',
        shell: 'default',
        operationId: expect.any(String)
      })
      return { ok: true, data: { kind: 'rejected', reason: 'capacity_exceeded' } }
    }
    if (route === 'terminal.stop') {
      stopCalls++
      expect(payload).toEqual({
        ref: { id: original.id, host: original.host },
        operationId: expect.any(String),
        controlRevision: original.controlRevision,
        cancelRevision: original.cancelRevision
      })
      const target = resources.find(
        (item) => item.id === original.id && item.host.generation === original.host.generation
      )
      if (!target) throw new Error('Unknown terminal scope')
      await stopWait
      if (closeOutcome === 'rejected') return { ok: true, data: { kind: 'rejected', reason: 'stale_control' } }
      const closed: TerminalResourceView = {
        ...target,
        process: { kind: 'exited', exitCode: 0, signal: null },
        cleanup: closeOutcome,
        revision: target.revision + 1
      }
      resources = resources.map((item) =>
        item.id === target.id && item.host.generation === target.host.generation ? closed : item
      )
      stopCompleted = true
      return { ok: true, data: { kind: 'resource', resource: closed } }
    }
    if (route === 'terminal.promote') {
      const input = payload as InputFor<'terminal.promote'>
      const resource = resources.find((item) => item.id === input.ref.id)
      if (!resource) throw new Error('Unknown execution')
      const promoted = { ...resource, revision: resource.revision + 1, retention: { kind: 'session' as const } }
      resources = [promoted]
      return { ok: true, data: { kind: 'resource', resource: promoted } }
    }
    throw new Error(`Unexpected terminal effect: ${route}`)
  })
})
afterEach(() => {
  cleanup()
  MockCacheUtils.resetMocks()
})

const capabilities: RightPanelCapability<null>[] = ['files', 'browser', 'terminal'].map((id) => ({
  component: () => null,
  resolve: () => ({ id, instanceKey: id, title: id, readiness: 'ready' })
}))
function Content({ attachment = false, emptyFiles = false }: { attachment?: boolean; emptyFiles?: boolean }) {
  const terminal = useTerminalResources()
  const panel = useRightPanelActions()
  const [files, setFiles] = useState<ArtifactPaneFileSelection[]>(
    emptyFiles
      ? []
      : [
          { workspacePath: '/workspace', filePath: 'README.md' },
          ...(attachment
            ? [
                {
                  workspacePath: '/workspace',
                  filePath: 'README.md',
                  previewType: 'file' as const,
                  readOnly: true as const,
                  displayName: 'Attachment.md'
                }
              ]
            : [])
        ]
  )
  const [selectedFile, setSelectedFile] = useState<ArtifactPaneFileSelection | null>(files[0] ?? null)
  return (
    <>
      <RightPanelShortcut tab="files" label={t('agent.right_pane.tabs.files')} icon={null} />
      <AgentResourceTabs
        files={files}
        selectedFile={selectedFile}
        dirty={false}
        activateFile={(file) => {
          setSelectedFile(file)
          panel.requestOpen('files')
        }}
        closeFile={(file) => setFiles((current) => current.filter((item) => item !== file))}
      />
      <ShellExecutionActions toolCallId="pending-bash" />
      <output aria-label="Terminal error">{terminal.error}</output>
      <output aria-label="Selected terminal">{terminal.tabs.selectedTerminalId}</output>
      <output aria-label="Selected file mode">{selectedFile?.previewType ?? 'artifact'}</output>
      {terminal.selectedCleanupId && <TerminalPane sessionId="resource-tabs-test" active />}
    </>
  )
}
function App({
  attachment = false,
  emptyFiles = false,
  sessionId = 'resource-tabs-test'
}: {
  attachment?: boolean
  emptyFiles?: boolean
  sessionId?: string
}) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
      <RightPanelProvider capabilities={capabilities} scope={null} defaultPanelId="files" defaultOpen>
        <TerminalResourcesProvider sessionId={sessionId} active>
          <AgentResourceHeaderProvider>
            <Content attachment={attachment} emptyFiles={emptyFiles} />
          </AgentResourceHeaderProvider>
        </TerminalResourcesProvider>
      </RightPanelProvider>
    </SWRConfig>
  )
}

function mount(options: { attachment?: boolean; emptyFiles?: boolean } = {}) {
  return render(<App {...options} />)
}

it('distinguishes a read-only attachment from an editable file at the same physical path', async () => {
  const user = userEvent.setup()
  mount({ attachment: true })
  await user.click(screen.getByRole('tab', { name: 'Attachment.md' }))
  expect(screen.getByLabelText('Selected file mode')).toHaveTextContent('file')
  await user.click(screen.getByRole('tab', { name: 'README.md' }))
  expect(screen.getByLabelText('Selected file mode')).toHaveTextContent('artifact')
})

it('opens and reopens the file browser from both entries without invoking the system file picker', async () => {
  const user = userEvent.setup()
  mount({ emptyFiles: true })
  const files = await screen.findByRole('tab', { name: t('agent.right_pane.tabs.files') })
  expect(files).toHaveAttribute('aria-selected', 'true')
  await user.click(await screen.findByRole('tab', { name: 'zsh 1' }))
  expect(files).toHaveAttribute('aria-selected', 'false')
  await user.click(screen.getByRole('button', { name: `${t('common.close')} ${t('agent.right_pane.tabs.files')}` }))
  expect(screen.queryByRole('tab', { name: t('agent.right_pane.tabs.files') })).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'zsh 1' })).toHaveAttribute('aria-selected', 'true')
  await user.click(screen.getByRole('button', { name: t('agent.resources.open_create') }))
  await user.click(screen.getByRole('menuitem', { name: t('agent.right_pane.tabs.files') }))
  expect(await screen.findByRole('tab', { name: t('agent.right_pane.tabs.files') })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await user.click(screen.getByRole('button', { name: `${t('common.close')} ${t('agent.right_pane.tabs.files')}` }))
  await waitFor(() => expect(screen.getByRole('tab', { name: 'zsh 1' })).toHaveAttribute('aria-selected', 'true'))
  await user.click(screen.getByRole('button', { name: t('agent.right_pane.tabs.files') }))
  expect(await screen.findByRole('tab', { name: t('agent.right_pane.tabs.files') })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(window.api.file.select).not.toHaveBeenCalled()
  expect(requests).not.toContain('terminal.create')
  expect(requests).not.toContain('terminal.stop')
})

it('keeps the last file-browser tab closed until explicitly reopened', async () => {
  resources = []
  const user = userEvent.setup()
  mount({ emptyFiles: true })
  await screen.findByRole('tab', { name: t('agent.right_pane.tabs.files') })
  await user.click(screen.getByRole('button', { name: `${t('common.close')} ${t('agent.right_pane.tabs.files')}` }))
  expect(screen.queryByRole('tab', { name: t('agent.right_pane.tabs.files') })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: t('agent.right_pane.tabs.files') })).toHaveAttribute(
    'aria-pressed',
    'false'
  )
  await user.click(screen.getByRole('button', { name: t('agent.right_pane.tabs.files') }))
  expect(await screen.findByRole('tab', { name: t('agent.right_pane.tabs.files') })).toHaveAttribute(
    'aria-selected',
    'true'
  )
})

it('returns to the selected file through the Files menu without opening another browser', async () => {
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('tab', { name: 'zsh 1' }))
  await user.click(screen.getByRole('button', { name: t('agent.resources.open_create') }))
  await user.click(screen.getByRole('menuitem', { name: t('agent.right_pane.tabs.files') }))
  expect(screen.getByRole('tab', { name: 'README.md' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByRole('tab', { name: t('agent.right_pane.tabs.files') })).not.toBeInTheDocument()
  expect(window.api.file.select).not.toHaveBeenCalled()
})

it('stops the process before removing its tab and does not list terminal history in the plus menu', async () => {
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('tab', { name: 'zsh 1' }))
  await user.click(screen.getByRole('button', { name: `${t('common.close')} zsh 1` }))
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'zsh 1' })).not.toBeInTheDocument())
  expect(resources[0].cleanup).toBe('confirmed')
  expect(resources[0].process.kind).toBe('exited')
  await user.click(screen.getByRole('button', { name: t('agent.resources.open_create') }))
  expect(screen.queryByRole('menuitem', { name: /zsh 1/ })).not.toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: t('terminal.new_terminal') })).toBeEnabled()
})

it.each(['unconfirmed', 'rejected'] as const)('keeps failed %s closure visible and allows retry', async (outcome) => {
  closeOutcome = outcome
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('tab', { name: 'zsh 1' }))
  await user.click(screen.getByRole('button', { name: `${t('common.close')} zsh 1` }))
  await waitFor(() => expect(screen.getByLabelText('Terminal error')).not.toBeEmptyDOMElement())
  expect(screen.getByRole('tab', { name: /^zsh 1/ })).toHaveAttribute('aria-selected', 'true')
  closeOutcome = 'confirmed'
  await user.click(screen.getByRole('button', { name: `${t('common.close')} zsh 1` }))
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'zsh 1' })).not.toBeInTheDocument())
  expect(resources[0].cleanup).toBe('confirmed')
})

it('joins repeated close requests and preserves a file selected during cleanup', async () => {
  const stop = Promise.withResolvers<void>()
  stopWait = stop.promise
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('tab', { name: 'zsh 1' }))
  const close = screen.getByRole('button', { name: `${t('common.close')} zsh 1` })
  await user.click(close)
  await user.click(close)
  expect(stopCalls).toBe(1)
  expect(screen.getByRole('tab', { name: 'zsh 1' })).toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: 'README.md' }))
  stop.resolve()
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'zsh 1' })).not.toBeInTheDocument())
  expect(screen.getByRole('tab', { name: 'README.md' })).toHaveAttribute('aria-selected', 'true')
})

it('closes an already exited terminal without requesting another stop', async () => {
  resources = [{ ...original, process: { kind: 'exited', exitCode: 0, signal: null }, cleanup: 'confirmed' }]
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('tab', { name: 'zsh 1' }))
  await user.click(screen.getByRole('button', { name: `${t('common.close')} zsh 1` }))
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'zsh 1' })).not.toBeInTheDocument())
  expect(stopCalls).toBe(0)
})

it('reports a rejected terminal creation while a file is selected', async () => {
  rejectCreation = true
  const user = userEvent.setup()
  mount()
  await user.click(screen.getByRole('button', { name: t('agent.resources.open_create') }))
  await user.click(screen.getByRole('menuitem', { name: t('terminal.new_terminal') }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('capacity_exceeded')))
  expect(screen.getByRole('tab', { name: 'README.md' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByLabelText('Selected terminal')).toBeEmptyDOMElement()
})

it('promotes a pending Bash call without opening a tab or re-executing the command', async () => {
  resources = [
    {
      ...structuredClone(original),
      kind: 'pipe',
      shell: 'bash',
      toolCallId: 'pending-bash',
      retention: { kind: 'turn', turnId: 'pending-bash' },
      control: { kind: 'agent', context: original.context }
    }
  ]
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('button', { name: t('terminal.run_background') }))
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: t('terminal.run_background') })).not.toBeInTheDocument()
  )
  expect(screen.queryByRole('tab', { name: /bash/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: t('terminal.output') }))
  expect(await screen.findByRole('tab', { name: /bash/ })).toBeInTheDocument()
  expect(screen.getByLabelText('Selected terminal')).toHaveTextContent(original.id)
  expect(resources[0].retention).toEqual({ kind: 'session' })
  expect(requests.filter((route) => route === 'terminal.promote')).toEqual(['terminal.promote'])
  expect(requests).not.toContain('terminal.create')
})

it('keeps recovered cleanup discoverable after its conversation was purged and retry is unavailable', async () => {
  resources = []
  recovered = true
  const user = userEvent.setup()
  mount()
  await user.click(screen.getByRole('button', { name: t('agent.resources.open_create') }))
  await user.click(await screen.findByRole('menuitem', { name: record.cwd }))
  expect(await screen.findByText(t('terminal.cleanup.protected'))).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: t('terminal.retry_close') }))
  await waitFor(() => expect(screen.getByRole('button', { name: t('terminal.retry_close') })).toBeEnabled())
  expect(screen.getByText(t('terminal.cleanup.protected'))).toBeInTheDocument()
  expect(requests).toContain('terminal.cleanup.retry')
  expect(requests).not.toContain('terminal.stop')
})

it('does not apply an old close receipt to another conversation', async () => {
  const stop = Promise.withResolvers<void>()
  stopWait = stop.promise
  const user = userEvent.setup()
  const mounted = mount()
  await user.click(await screen.findByRole('tab', { name: 'zsh 1' }))
  await user.click(screen.getByRole('button', { name: `${t('common.close')} zsh 1` }))
  resources = [
    {
      ...original,
      host: {
        ...original.host,
        generation: '55555555-5555-4555-8555-555555555555' as TerminalResourceView['host']['generation']
      }
    }
  ]
  mounted.rerender(<App sessionId="another-conversation" />)
  await user.click(await screen.findByRole('tab', { name: 'zsh 1' }))
  stop.resolve()
  await waitFor(() => expect(stopCompleted).toBe(true))
  expect(resources[0].process.kind).toBe('running')
  expect(screen.getByRole('tab', { name: 'zsh 1' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByLabelText('Terminal error')).toBeEmptyDOMElement()
})
