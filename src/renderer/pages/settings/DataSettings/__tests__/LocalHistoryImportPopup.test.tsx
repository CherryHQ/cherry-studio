import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
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
  it('keeps successful imports and exposes skipped content with source locations', async () => {
    agents([{ id: 'a', name: 'Alpha', type: 'pi' }])
    const normal = request.getMockImplementation()!
    request.mockImplementation(async (...args) => {
      const result = await normal(...args)
      if (args[0] === 'conversation_import.preview') {
        Object.assign(result.items[0], {
          skippedRecords: 1,
          downgradedParts: 2,
          diagnostics: [
            { code: 'invalid_json', severity: 'warning', path: '/source/task.jsonl', line: 2 },
            { code: 'unsupported_attachment', severity: 'warning', path: '/source/task.jsonl', line: 3 }
          ]
        })
      }
      return result
    })
    const user = userEvent.setup()
    render(<LocalHistoryImportDialog open source="claude-code" resolve={() => {}} />)
    await chooseAgent(user)
    await user.click(screen.getByRole('checkbox', { name: /Original task/ }))
    await user.click(screen.getByRole('button', { name: enUS['history_import.confirm'] }))
    await screen.findByText(enUS['history_import.results.imported'])
    expect(screen.getByText('Skipped records: 1 · Converted content blocks: 2')).toBeVisible()
    expect(screen.getByText(/2 messages/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Import warnings' }))
    expect(screen.getByText('/source/task.jsonl · Line 2')).toBeVisible()
    expect(screen.getByText('/source/task.jsonl · Line 3')).toBeVisible()
    expect(screen.queryByText(enUS['history_import.problems.unsupported'])).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: enUS['common.retry'] })).not.toBeInTheDocument()
  })
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
      if (args[0] === 'conversation_import.commit' && blocked)
        return [{ ref: 'ref', status: 'failed', reason: 'preview_blocked' }]
      const result = await original(...args)
      if (args[0] === 'conversation_import.preview') {
        result.previewId = blocked ? 'blocked' : 'fresh'
        if (blocked)
          result.items[0].diagnostics = [
            { code: 'target_changed', severity: 'error' },
            { code: 'target_changed', severity: 'error', line: 25 },
            { code: 'reasoning_compatibility', severity: 'warning' }
          ]
      }
      return result
    })
    const user = userEvent.setup()
    render(<LocalHistoryImportDialog open source="codex" resolve={() => {}} />)
    await chooseAgent(user)
    await user.click(screen.getByRole('checkbox', { name: /Original task/ }))
    await user.click(screen.getByRole('button', { name: enUS['history_import.confirm'] }))
    await screen.findByText(enUS['history_import.problems.target'])
    const issues = screen.getByRole('dialog', { name: enUS['history_import.error_title'] })
    expect(issues).toHaveTextContent('1 conversations could not be imported')
    expect(within(issues).getByRole('heading')).toHaveFocus()
    expect(within(issues).getAllByRole('listitem')).toHaveLength(1)
    expect(within(issues).queryByText(enUS['history_import.results.imported'])).toBeNull()
    await user.click(within(issues).getByText(enUS['common.close'], { selector: 'button' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: enUS['history_import.error_title'] })).toBeNull())
    expect(screen.getByRole('checkbox', { name: /Original task/ })).toBeChecked()
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
  it('keeps batch successes and retries only the remaining selection', async () => {
    agents([{ id: 'a', name: 'Alpha', type: 'pi' }])
    const original = request.getMockImplementation()!
    let blocked = true
    request.mockImplementation(async (route, payload) => {
      const result = await original(route, payload)
      if (route === 'conversation_import.discover')
        result.candidates.push({ ref: 'bad', title: 'Blocked task', sourcePath: '/source/bad.jsonl' })
      if (route === 'conversation_import.preview')
        result.items = payload.selections.map(({ ref }: { ref: string }) => ({
          ...result.items[0],
          ref,
          title: ref === 'bad' ? 'Blocked task' : 'Original task',
          diagnostics: ref === 'bad' && blocked ? [{ code: 'directory_required', severity: 'error' }] : []
        }))
      if (route === 'conversation_import.commit')
        return payload.refs.map((ref: string) =>
          ref === 'bad' && blocked
            ? { ref, status: 'failed', reason: 'preview_blocked' }
            : { ref, status: 'imported', sessionId: 'saved-' + ref, initialization: 'ready' }
        )
      return result
    })
    const user = userEvent.setup()
    render(<LocalHistoryImportDialog open source="codex" resolve={() => {}} />)
    await chooseAgent(user)
    await user.click(screen.getByRole('checkbox', { name: enUS['common.select_all'] }))
    await user.click(screen.getByRole('button', { name: enUS['history_import.confirm'] }))
    const issues = await screen.findByRole('dialog', { name: enUS['history_import.error_title'] })
    await user.click(within(issues).getByText(enUS['common.close'], { selector: 'button' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: enUS['history_import.error_title'] })).toBeNull())
    expect(screen.getByRole('status')).toHaveTextContent('Imported · 1')
    expect(screen.queryByRole('checkbox', { name: /Original task/ })).toBeNull()
    expect(screen.getByRole('checkbox', { name: /Blocked task/ })).toBeChecked()
    blocked = false
    await user.click(screen.getByRole('button', { name: enUS['history_import.confirm'] }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Imported · 2'))
    expect(screen.getAllByText(enUS['history_import.results.imported'])).toHaveLength(2)
    expect(
      request.mock.calls.filter(([route]) => route === 'conversation_import.commit').map(([, payload]) => payload.refs)
    ).toEqual([['ref', 'bad'], ['bad']])
  })
  it('offers no repair choices or retry when an unsupported history also reports directory and branch conflicts', async () => {
    agents([{ id: 'a', name: 'Alpha', type: 'pi' }])
    const original = request.getMockImplementation()!
    request.mockImplementation(async (route, payload) => {
      const result = await original(route, payload)
      if (route === 'conversation_import.preview')
        Object.assign(result.items[0], {
          branches: ['a', 'b'],
          originalDirectory: '/missing',
          diagnostics: [
            { code: 'unsupported_history_layout', severity: 'error' },
            { code: 'directory_required', severity: 'error' },
            { code: 'branch_required', severity: 'error' },
            { code: 'empty_session', severity: 'error' }
          ]
        })
      if (route === 'conversation_import.commit') return [{ ref: 'ref', status: 'failed', reason: 'preview_blocked' }]
      return result
    })
    const user = userEvent.setup()
    render(<LocalHistoryImportDialog open source="codex" resolve={() => {}} />)
    await chooseAgent(user)
    await user.click(screen.getByRole('checkbox', { name: /Original task/ }))
    await user.click(screen.getByRole('button', { name: enUS['history_import.confirm'] }))
    const issues = await screen.findByRole('dialog', { name: enUS['history_import.error_title'] })
    expect(within(issues).getByText(enUS['history_import.problems.unsupported'])).toBeInTheDocument()
    expect(within(issues).queryByText(enUS['history_import.problems.directory'])).toBeNull()
    expect(within(issues).queryByText(enUS['history_import.problems.branch'])).toBeNull()
    expect(within(issues).queryByRole('combobox')).toBeNull()
    expect(within(issues).queryByRole('button', { name: enUS['history_import.folder'] })).toBeNull()
    expect(within(issues).queryByRole('button', { name: enUS['common.retry'] })).toBeNull()
    await user.click(within(issues).getByText(enUS['common.close'], { selector: 'button' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: enUS['history_import.error_title'] })).toBeNull())
    expect(screen.queryByRole('button', { name: enUS['history_import.confirm'] })).toBeNull()
  })
  it('keeps branch selection available when choosing a branch can resolve the empty preview', async () => {
    agents([{ id: 'a', name: 'Alpha', type: 'pi' }])
    const original = request.getMockImplementation()!
    request.mockImplementation(async (route, payload) => {
      const result = await original(route, payload)
      if (route === 'conversation_import.preview')
        Object.assign(result.items[0], {
          branches: ['a', 'b'],
          diagnostics: [
            { code: 'branch_required', severity: 'error' },
            { code: 'empty_session', severity: 'error' }
          ]
        })
      if (route === 'conversation_import.commit') return [{ ref: 'ref', status: 'failed', reason: 'preview_blocked' }]
      return result
    })
    const user = userEvent.setup()
    render(<LocalHistoryImportDialog open source="claude-code" resolve={() => {}} />)
    await chooseAgent(user)
    await user.click(screen.getByRole('checkbox', { name: /Original task/ }))
    await user.click(screen.getByRole('button', { name: enUS['history_import.confirm'] }))
    const issues = await screen.findByRole('dialog', { name: enUS['history_import.error_title'] })
    expect(within(issues).getByRole('combobox', { name: enUS['history_import.branch'] })).toBeEnabled()
    expect(within(issues).getByRole('button', { name: enUS['common.retry'] })).toBeEnabled()
  })
  it('opens commit failures separately and keeps the result summary available after closing', async () => {
    agents([{ id: 'a', name: 'Alpha', type: 'pi' }])
    const original = request.getMockImplementation()!
    request.mockImplementation(async (...args) =>
      args[0] === 'conversation_import.commit'
        ? [{ ref: 'ref', status: 'failed', reason: 'source_changed' }]
        : original(...args)
    )
    const user = userEvent.setup()
    render(<LocalHistoryImportDialog open source="codex" resolve={() => {}} />)
    await chooseAgent(user)
    await user.click(screen.getByRole('checkbox', { name: /Original task/ }))
    await user.click(screen.getByRole('button', { name: enUS['history_import.confirm'] }))
    const issues = await screen.findByRole('dialog', { name: enUS['history_import.error_title'] })
    expect(within(issues).getByText(enUS['history_import.problems.changed'])).toBeInTheDocument()
    await user.click(within(issues).getByText(enUS['common.close'], { selector: 'button' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: enUS['history_import.error_title'] })).toBeNull())
    expect(screen.getByText(enUS['history_import.results.failed'])).toBeInTheDocument()
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
    const issues = await screen.findByRole('dialog', { name: enUS['history_import.error_title'] })
    await user.click(within(issues).getByText(enUS['common.close'], { selector: 'button' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: enUS['history_import.error_title'] })).toBeNull())
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
  it('explains an all-filtered scan without selectable records or an error dialog', async () => {
    request.mockResolvedValue({
      scanId: 'scan',
      root: '/source',
      candidates: [],
      filtered: { codex_guardian_review: 3, claude_no_user_task: 0 }
    })
    agents([{ id: 'pi', name: 'Alpha', type: 'pi' }])
    render(<LocalHistoryImportDialog open source="codex" resolve={() => {}} />)
    expect(await screen.findByText(enUS['history_import.filtered_empty'])).toBeVisible()
    expect(screen.queryByText(/Guardian reviews/)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: enUS['common.select_all'] })).toBeDisabled()
    expect(screen.getByRole('button', { name: enUS['history_import.confirm'] })).toBeDisabled()
    expect(screen.queryByText(enUS['history_import.error_title'])).not.toBeInTheDocument()
  })
  it('removes revalidated filtered selections without showing retry or failure actions', async () => {
    const original = request.getMockImplementation()!
    request.mockImplementation(async (route, input) => {
      if (route === 'conversation_import.commit')
        return [{ ref: 'ref', status: 'filtered', reason: 'claude_no_user_task' }]
      return original(route, input)
    })
    agents([{ id: 'pi', name: 'Alpha', type: 'pi' }])
    const user = userEvent.setup()
    render(<LocalHistoryImportDialog open source="claude-code" resolve={() => {}} />)
    await chooseAgent(user)
    await user.click(screen.getByRole('checkbox', { name: /Original task/ }))
    await user.click(screen.getByRole('button', { name: enUS['history_import.confirm'] }))
    expect(await screen.findByText(enUS['history_import.filtered_empty'])).toBeVisible()
    expect(screen.queryByText('Original task')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: enUS['common.retry'] })).not.toBeInTheDocument()
    expect(screen.queryByText(enUS['history_import.results.failed'])).not.toBeInTheDocument()
  })
})
