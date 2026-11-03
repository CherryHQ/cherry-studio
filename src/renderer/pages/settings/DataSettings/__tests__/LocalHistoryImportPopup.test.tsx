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
  async function chooseAgent(user: ReturnType<typeof userEvent.setup>, name = 'Alpha') {
    await screen.findByText('Original task')
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name }))
  }
  it('explains unsupported targets and does not expose a preview button', async () => {
    agents([{ id: 'claude', name: 'Cherry assistant', type: 'claude-code' }])
    const user = userEvent.setup()
    render(<LocalHistoryImportDialog open source="codex" resolve={() => {}} />)
    await screen.findByText('Original task')
    expect(screen.queryByRole('button', { name: enUS['history_import.preview'] })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: enUS['history_import.confirm'] })).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
    await user.click(screen.getByRole('combobox'))
    const option = screen.getByRole('option', {
      name: 'Cherry assistant · ' + enUS['history_import.unsupported_target']
    })
    expect(option).toHaveAttribute('aria-disabled', 'true')
    expect(option).not.toHaveTextContent('claude-code')
  })
  it('enables Codex import on selection and validates before committing in one action', async () => {
    agents([{ id: 'a', name: 'Alpha', type: 'pi' }])
    const user = userEvent.setup()
    render(<LocalHistoryImportDialog open source="codex" resolve={() => {}} />)
    await chooseAgent(user)
    await user.click(screen.getByRole('checkbox', { name: /Original task/ }))
    const button = screen.getByRole('button', { name: enUS['history_import.confirm'] })
    expect(button).toBeEnabled()
    expect(request.mock.calls.filter(([route]) => route === 'conversation_import.commit')).toHaveLength(0)
    await user.click(button)
    await screen.findByText(enUS['history_import.results.imported'])
    const calls = request.mock.calls.filter(
      ([route]) => route === 'conversation_import.preview' || route === 'conversation_import.commit'
    )
    expect(calls).toEqual([
      ['conversation_import.preview', { scanId: 'scan', targetAgentId: 'a', selections: [{ ref: 'ref' }] }],
      ['conversation_import.commit', { previewId: 'preview', refs: ['ref'] }]
    ])
  })
  it('shows blocking validation and revalidates with the changed target before writing', async () => {
    agents([
      { id: 'a', name: 'Alpha', type: 'pi' },
      { id: 'b', name: 'Beta', type: 'pi' }
    ])
    const original = request.getMockImplementation()!
    let blocked = true
    request.mockImplementation(async (...args) => {
      const result = await original(...args)
      if (args[0] === 'conversation_import.preview') {
        result.previewId = blocked ? 'blocked' : 'fresh'
        if (blocked) result.items[0].diagnostics = [{ code: 'unsupported_history_layout', severity: 'error' }]
      }
      return result
    })
    const user = userEvent.setup()
    render(<LocalHistoryImportDialog open source="codex" resolve={() => {}} />)
    await chooseAgent(user)
    await user.click(screen.getByRole('checkbox', { name: /Original task/ }))
    await user.click(screen.getByRole('button', { name: enUS['history_import.confirm'] }))
    await screen.findByText(enUS['history_import.problems.unsupported'])
    expect(screen.getByRole('alert')).toHaveTextContent('1 conversations could not be imported')
    expect(screen.getByRole('region', { name: 'Original task' })).toHaveFocus()
    expect(request.mock.calls.some(([route]) => route === 'conversation_import.commit')).toBe(false)
    blocked = false
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Beta' }))
    await user.click(screen.getByRole('button', { name: enUS['history_import.confirm'] }))
    await screen.findByText(enUS['history_import.results.imported'])
    expect(request).toHaveBeenCalledWith('conversation_import.preview', {
      scanId: 'scan',
      targetAgentId: 'b',
      selections: [{ ref: 'ref' }]
    })
    expect(request).toHaveBeenCalledWith('conversation_import.commit', { previewId: 'fresh', refs: ['ref'] })
  })
  it('supports select all, mixed selection and deselect all', async () => {
    agents([{ id: 'a', name: 'Alpha', type: 'pi' }])
    const original = request.getMockImplementation()!
    request.mockImplementation(async (...args) => {
      const result = await original(...args)
      if (args[0] === 'conversation_import.discover')
        result.candidates.push({ ref: 'second', title: 'Second task', sourcePath: '/source/second.jsonl' })
      return result
    })
    const user = userEvent.setup()
    render(<LocalHistoryImportDialog open source="codex" resolve={() => {}} />)
    await chooseAgent(user)
    const all = screen.getByRole('checkbox', { name: enUS['common.select_all'] })
    const first = screen.getByRole('checkbox', { name: /Original task/ })
    const second = screen.getByRole('checkbox', { name: /Second task/ })
    await user.click(all)
    expect(first).toBeChecked()
    expect(second).toBeChecked()
    await user.click(first)
    expect(all).toBePartiallyChecked()
    await user.click(all)
    expect(first).toBeChecked()
    expect(second).toBeChecked()
    await user.click(all)
    expect(first).not.toBeChecked()
    expect(second).not.toBeChecked()
    expect(screen.getByRole('button', { name: enUS['history_import.confirm'] })).toBeDisabled()
  })
  it('finds the default source automatically without requiring folder selection', async () => {
    agents([{ id: 'a', name: 'Alpha', type: 'pi' }])
    render(<LocalHistoryImportDialog open source="claude-code" resolve={() => {}} />)
    expect(await screen.findByText('Original task')).toBeInTheDocument()
    expect(screen.getByLabelText(enUS['history_import.storage'])).toHaveValue('/source')
    expect(request).toHaveBeenCalledWith('conversation_import.discover', { source: 'claude-code' })
  })
  it('allows a custom source after automatic discovery fails', async () => {
    request.mockRejectedValueOnce(new Error('ENOENT'))
    agents([{ id: 'a', name: 'Alpha', type: 'pi' }])
    const user = userEvent.setup()
    render(<LocalHistoryImportDialog open source="claude-code" resolve={() => {}} />)
    await screen.findByRole('alert')
    await user.type(screen.getByLabelText(enUS['history_import.storage']), '/custom')
    await user.click(screen.getByRole('button', { name: enUS['history_import.scan'] }))
    expect(await screen.findByText('Original task')).toBeInTheDocument()
    expect(request).toHaveBeenLastCalledWith('conversation_import.discover', { source: 'claude-code', root: '/custom' })
  })
  it('limits select-all to the visible batch of 100 conversations', async () => {
    agents([{ id: 'a', name: 'Alpha', type: 'pi' }])
    const original = request.getMockImplementation()!
    request.mockImplementation(async (...args) => {
      const result = await original(...args)
      if (args[0] === 'conversation_import.discover')
        result.candidates = Array.from({ length: 101 }, (_, i) => ({
          ref: String(i),
          title: i ? 'Task ' + i : 'Original task',
          sourcePath: '/source/' + i
        }))
      return result
    })
    const user = userEvent.setup()
    render(<LocalHistoryImportDialog open source="codex" resolve={() => {}} />)
    await chooseAgent(user)
    await user.click(screen.getByRole('checkbox', { name: enUS['common.select_all'] }))
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(101)
    expect(screen.getByText(/Selected 100 of 101 conversations/)).toBeInTheDocument()
  })
})
