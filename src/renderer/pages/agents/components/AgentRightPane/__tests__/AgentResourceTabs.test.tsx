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
  useRightPanelActions,
  type RightPanelCapability
} from '@renderer/components/chat/panes/Shell'
import { ShellExecutionActions } from '@renderer/components/terminal/ShellExecutionActions'
import { TerminalPane } from '@renderer/components/terminal/TerminalPane'
import {
  TerminalResourcesProvider,
  useTerminalResources
} from '@renderer/components/terminal/TerminalResourcesProvider'
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
    if (route === 'terminal.shells') return { ok: true, data: ['bash'] }
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
function Content({ attachment = false }: { attachment?: boolean }) {
  const terminal = useTerminalResources()
  const panel = useRightPanelActions()
  const [files, setFiles] = useState<ArtifactPaneFileSelection[]>([
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
  ])
  const [selectedFile, setSelectedFile] = useState<ArtifactPaneFileSelection | null>(files[0])
  return (
    <>
      <AgentResourceTabs
        files={files}
        selectedFile={selectedFile}
        dirty={false}
        activateFile={(file) => {
          setSelectedFile(file)
          panel.requestOpen('files')
        }}
        closeFile={(file) => setFiles((current) => current.filter((item) => item !== file))}
        openFile={() => {}}
      />
      <ShellExecutionActions toolCallId="pending-bash" />
      <output aria-label="Selected terminal">{terminal.tabs.selectedTerminalId}</output>
      <output aria-label="Selected file mode">{selectedFile?.previewType ?? 'artifact'}</output>
      {terminal.selectedCleanupId && <TerminalPane sessionId="resource-tabs-test" active />}
    </>
  )
}
function mount(attachment = false) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
      <RightPanelProvider capabilities={capabilities} scope={null} defaultPanelId="files" defaultOpen>
        <TerminalResourcesProvider sessionId="resource-tabs-test" active>
          <AgentResourceHeaderProvider>
            <Content attachment={attachment} />
          </AgentResourceHeaderProvider>
        </TerminalResourcesProvider>
      </RightPanelProvider>
    </SWRConfig>
  )
}

it('distinguishes a read-only attachment from an editable file at the same physical path', async () => {
  const user = userEvent.setup()
  mount(true)
  await user.click(screen.getByRole('tab', { name: 'Attachment.md' }))
  expect(screen.getByLabelText('Selected file mode')).toHaveTextContent('file')
  await user.click(screen.getByRole('tab', { name: 'README.md' }))
  expect(screen.getByLabelText('Selected file mode')).toHaveTextContent('artifact')
})

it('closes and reopens a terminal view without starting or stopping its process', async () => {
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('tab', { name: 'zsh 1' }))
  expect(screen.getByLabelText('Selected terminal')).toHaveTextContent(original.id)
  await user.click(screen.getByRole('button', { name: `${t('common.close')} zsh 1` }))
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'zsh 1' })).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: t('agent.resources.open_create') }))
  await user.click(await screen.findByRole('menuitem', { name: /zsh 1/ }))
  expect(await screen.findByRole('tab', { name: 'zsh 1' })).toBeInTheDocument()
  expect(screen.getByLabelText('Selected terminal')).toHaveTextContent(original.id)
  expect(requests.filter((route) => ['terminal.create', 'terminal.stop', 'terminal.action'].includes(route))).toEqual(
    []
  )
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
