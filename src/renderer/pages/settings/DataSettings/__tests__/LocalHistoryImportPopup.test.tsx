import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import enUS from '@renderer/i18n/locales/en-us.json'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('@cherrystudio/ui', async (original) => await original())
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: keyof typeof enUS, values?: Record<string, unknown>) =>
      (enUS[key] ?? key).replace(/{{(\w+)}}/g, (_, name) => String(values?.[name] ?? ''))
  })
}))
import { LocalHistoryImportDialog } from '../LocalHistoryImportPopup'

const browserMethods = ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView'] as const
const originalMethods = new Map(
  browserMethods.map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)])
)
beforeAll(() => {
  for (const name of browserMethods)
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      value: name === 'hasPointerCapture' ? () => false : () => {}
    })
})
afterAll(() => {
  for (const name of browserMethods) {
    const descriptor = originalMethods.get(name)
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, name)
  }
})

function agents(items: { id: string; name: string; type: 'pi' | 'claude-code' }[]) {
  MockUseDataApiUtils.mockQueryData('/agents', { items: items as AgentEntity[], total: items.length, page: 1 })
}
beforeEach(() => {
  request.mockReset()
  MockUseDataApiUtils.resetMocks()
  request.mockImplementation(async (route) => {
    if (route === 'conversation_import.discover')
      return {
        scanId: 'scan',
        root: '/source',
        candidates: [{ ref: 'ref', title: 'Original task', sourcePath: '/source/task.jsonl' }]
      }
    if (route === 'conversation_import.preview')
      return {
        previewId: 'preview',
        expiresAt: Date.now() + 1000,
        items: [
          {
            ref: 'ref',
            title: 'Original task',
            sourcePath: '/source/task.jsonl',
            originalSessionId: 'source',
            branches: ['leaf'],
            branchId: 'leaf',
            messageCount: 2,
            models: [],
            diagnostics: [],
            skippedRecords: 0,
            downgradedParts: 0
          }
        ]
      }
    if (route === 'conversation_import.commit')
      return [{ ref: 'ref', status: 'imported', sessionId: 'new', initialization: 'ready' }]
    return undefined
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('local history import dialog', () => {
  it('explains unsupported targets and requires an explicit existing Pi selection', async () => {
    agents([{ id: 'claude', name: 'Claude target', type: 'claude-code' }])
    const user = userEvent.setup()
    render(<LocalHistoryImportDialog open source="claude-code" resolve={() => {}} />)
    expect(screen.getByText(enUS['history_import.no_target'])).toBeInTheDocument()
    expect(screen.getByRole('button', { name: enUS['history_import.preview'] })).toBeDisabled()
    await user.click(screen.getByRole('combobox'))
    const target = screen.getByRole('option', { name: /Claude target/ })
    expect(target).toHaveAttribute('aria-disabled', 'true')
    expect(target).toHaveTextContent(enUS['history_import.unsupported_target'])
  })
  it('invalidates confirmation after changing the target and submits only a fresh preview token', async () => {
    agents([
      { id: 'a', name: 'Alpha', type: 'pi' },
      { id: 'b', name: 'Beta', type: 'pi' }
    ])
    const user = userEvent.setup()
    render(<LocalHistoryImportDialog open source="claude-code" resolve={() => {}} />)
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /Alpha/ }))
    await user.click(screen.getByRole('button', { name: enUS['history_import.scan'] }))
    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: enUS['history_import.preview'] }))
    const confirm = screen.getByRole('button', { name: enUS['history_import.confirm'] })
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(screen.getByText(enUS['history_import.no_directory'])).toBeInTheDocument()
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /Beta/ }))
    expect(confirm).toBeDisabled()
    await user.click(screen.getByRole('button', { name: enUS['history_import.preview'] }))
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(request).toHaveBeenCalledWith('conversation_import.preview', {
      scanId: 'scan',
      targetAgentId: 'b',
      selections: [{ ref: 'ref' }]
    })
    await user.click(confirm)
    await screen.findByText(enUS['history_import.results.imported'])
    expect(request).toHaveBeenCalledWith('conversation_import.commit', { previewId: 'preview', refs: ['ref'] })
  })
  it('finds the default source automatically without requiring folder selection', async () => {
    agents([{ id: 'a', name: 'Alpha', type: 'pi' }])
    render(<LocalHistoryImportDialog open source="claude-code" resolve={() => {}} />)
    expect(await screen.findByText('Original task')).toBeInTheDocument()
    expect(screen.getByLabelText(enUS['history_import.storage'])).toHaveValue('/source')
    expect(request).toHaveBeenCalledWith('conversation_import.discover', { source: 'claude-code' })
    expect(screen.getByRole('button', { name: enUS['history_import.confirm'] })).toBeDisabled()
  })
  it('allows a custom source after automatic discovery fails', async () => {
    request.mockRejectedValueOnce(new Error('ENOENT'))
    agents([{ id: 'a', name: 'Alpha', type: 'pi' }])
    const user = userEvent.setup()
    render(<LocalHistoryImportDialog open source="claude-code" resolve={() => {}} />)
    await screen.findByRole('alert')
    const input = screen.getByLabelText(enUS['history_import.storage'])
    await user.type(input, '/custom')
    await user.click(screen.getByRole('button', { name: enUS['history_import.scan'] }))
    expect(await screen.findByText('Original task')).toBeInTheDocument()
    expect(request).toHaveBeenLastCalledWith('conversation_import.discover', { source: 'claude-code', root: '/custom' })
  })
})
