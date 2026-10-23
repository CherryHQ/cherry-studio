import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'

import SandboxDialog from '../SandboxDialog'

vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

const domMethods = ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView'] as const
const originalMethods = domMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name))
beforeAll(() => {
  for (const name of domMethods) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: () => false })
  }
})
afterAll(() => {
  domMethods.forEach((name, index) => {
    const original = originalMethods[index]
    if (original) Object.defineProperty(HTMLElement.prototype, name, original)
    else Reflect.deleteProperty(HTMLElement.prototype, name)
  })
})

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
})
afterEach(() => {
  cleanup()
  vi.mocked(ipcApi.request).mockReset()
})

it('runs the selected example with its deadline and lets the user stop it before choosing another', async () => {
  const user = userEvent.setup()
  let finish!: (value: { stdout: string; stderr: string; report: string }) => void
  const running = new Promise<{ stdout: string; stderr: string; report: string }>((resolve) => {
    finish = resolve
  })
  vi.mocked(ipcApi.request).mockImplementation(async (method) => {
    if (method === 'sandbox.run') return running
    if (method === 'sandbox.stop') {
      finish({ stdout: 'started', stderr: '', report: '{"reason":"cancelled"}' })
      return undefined
    }
    throw new Error(`Unexpected method: ${method}`)
  })
  render(<SandboxDialog open onOpenChange={() => {}} />)
  await user.click(screen.getByRole('tab', { name: 'Custom script' }))
  await user.click(screen.getByRole('combobox', { name: 'Test example' }))
  await user.click(screen.getByRole('option', { name: 'Terminate on timeout' }))
  expect(screen.getByLabelText('JavaScript')).toHaveValue("console.log('started')\nsetInterval(() => {}, 1000)")
  await user.click(screen.getByRole('button', { name: 'Run in sandbox' }))
  expect(ipcApi.request).toHaveBeenCalledWith('sandbox.run', {
    code: expect.stringContaining('setInterval'),
    timeoutMs: 1000
  })
  expect(screen.getByRole('combobox', { name: 'Test example' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Run in sandbox' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Stop' }))
  await waitFor(() =>
    expect(screen.getByLabelText('Output and diagnostics')).toHaveValue('started\n{"reason":"cancelled"}')
  )
  await user.click(screen.getByRole('combobox', { name: 'Test example' }))
  await user.click(screen.getByRole('option', { name: 'Create, read, rename and delete files' }))
  expect(screen.getByLabelText('Output and diagnostics')).toHaveValue('')
  expect(screen.getByLabelText('JavaScript')).toHaveProperty('value', expect.stringContaining('renameSync'))
  expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()
})

it('runs edited code and recovers from a failed request without presenting the example expectation as a result', async () => {
  const user = userEvent.setup()
  vi.mocked(ipcApi.request).mockRejectedValueOnce(new Error('Backend unavailable'))
  render(<SandboxDialog open onOpenChange={() => {}} />)
  await user.click(screen.getByRole('tab', { name: 'Custom script' }))
  const editor = screen.getByLabelText('JavaScript')
  await user.clear(editor)
  await user.type(editor, 'process.stdout.write("custom")')
  expect(screen.queryByText('Expected result (compare with the output below):')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Run in sandbox' }))
  await waitFor(() => expect(screen.getByLabelText('Output and diagnostics')).toHaveValue('Error: Backend unavailable'))
  expect(ipcApi.request).toHaveBeenCalledWith('sandbox.run', {
    code: 'process.stdout.write("custom")',
    timeoutMs: 30000
  })
  vi.mocked(ipcApi.request).mockResolvedValueOnce({ stdout: 'custom', stderr: '', report: '{"reason":"exited"}' })
  await user.click(screen.getByRole('button', { name: 'Run in sandbox' }))
  await waitFor(() =>
    expect(screen.getByLabelText('Output and diagnostics')).toHaveValue('custom\n{"reason":"exited"}')
  )
})

it('shows permission failures and unsupported backends distinctly and can rerun a group', async () => {
  const user = userEvent.setup()
  vi.mocked(ipcApi.request).mockResolvedValueOnce({
    results: [
      { id: 'direct-bypass', status: 'failed', expected: 'EPERM', actual: 'connected' },
      { id: 'backend', status: 'unsupported', expected: 'ready', actual: 'Windows proxy not supported' }
    ],
    report: 'evidence'
  })
  render(<SandboxDialog open onOpenChange={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Network allowlist' }))
  await user.click(screen.getByRole('button', { name: 'Run regression checks' }))
  expect(await screen.findByText('Failed')).toBeVisible()
  expect(screen.getByText('Unsupported')).toBeVisible()
  expect(screen.getByText('connected')).toBeVisible()
  expect(screen.getByText('Windows proxy not supported')).toBeVisible()
  vi.mocked(ipcApi.request).mockResolvedValueOnce({
    results: [{ id: 'direct-bypass', status: 'passed', expected: 'EPERM', actual: 'EPERM' }],
    report: 'new evidence'
  })
  await user.click(screen.getByRole('button', { name: 'Network allowlist' }))
  await user.click(screen.getByRole('button', { name: 'Run regression checks' }))
  expect(await screen.findByText('Passed')).toBeVisible()
  expect(screen.queryByText('connected')).not.toBeInTheDocument()
})

it('stops the active group and does not launch the remaining groups of Run all', async () => {
  const user = userEvent.setup()
  let finish!: (value: { results: []; report: string }) => void
  const running = new Promise<{ results: []; report: string }>((resolve) => {
    finish = resolve
  })
  const groups: string[] = []
  vi.mocked(ipcApi.request).mockImplementation(async (method, input) => {
    if (method === 'sandbox.diagnose') {
      if (input && typeof input === 'object' && 'group' in input) groups.push(input.group)
      return running
    }
    if (method === 'sandbox.stop') {
      finish({ results: [], report: 'cancelled' })
      return undefined
    }
    throw new Error(`Unexpected method: ${method}`)
  })
  render(<SandboxDialog open onOpenChange={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Run all' }))
  expect(screen.getByRole('button', { name: 'Run regression checks' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Stop' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run all' })).toBeEnabled())
  expect(groups).toEqual(['files'])
  await user.click(screen.getByRole('button', { name: 'Output and diagnostics' }))
  expect(screen.getByText('cancelled')).toBeVisible()
})

it('exposes RPC and allowlist coverage before running and keeps results when switching groups or using scripts', async () => {
  const user = userEvent.setup()
  render(<SandboxDialog open onOpenChange={() => {}} />)
  expect(screen.queryByLabelText('JavaScript')).not.toBeInTheDocument()
  expect(screen.getByText(/Calls compute\(value\) in the sandbox/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Network allowlist' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Bidirectional RPC' }))
  expect(ipcApi.request).not.toHaveBeenCalled()
  vi.mocked(ipcApi.request).mockResolvedValueOnce({
    results: [{ id: 'nested-callback', status: 'passed', expected: '41', actual: '41' }],
    report: 'RPC evidence'
  })
  await user.click(screen.getByRole('button', { name: 'Run regression checks' }))
  expect(ipcApi.request).toHaveBeenLastCalledWith('sandbox.diagnose', { group: 'rpc' })
  expect(await screen.findByRole('button', { name: 'Host → sandbox → host callback Passed' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Network allowlist' }))
  vi.mocked(ipcApi.request).mockResolvedValueOnce({
    results: [{ id: 'allowlisted-http', status: 'passed', expected: '200', actual: '200' }],
    report: 'Network evidence'
  })
  await user.click(screen.getByRole('button', { name: 'Run regression checks' }))
  expect(ipcApi.request).toHaveBeenLastCalledWith('sandbox.diagnose', { group: 'network' })
  expect(await screen.findByText('Access an allowlisted HTTP target')).toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'Custom script' }))
  expect(screen.getByLabelText('JavaScript')).toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'Capability tests' }))
  await user.click(screen.getByRole('button', { name: 'Bidirectional RPC' }))
  expect(screen.getByRole('button', { name: 'Host → sandbox → host callback Passed' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Output and diagnostics' }))
  expect(screen.getByText('RPC evidence')).toBeVisible()
})

it('sends editable RPC parameters, shows the callback trace and lets authorization be disabled', async () => {
  const user = userEvent.setup()
  render(<SandboxDialog open onOpenChange={() => {}} />)
  const input = screen.getByRole('spinbutton', { name: 'Request parameter: value' })
  await user.clear(input)
  await user.click(screen.getByRole('button', { name: 'Send request' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Check the numeric parameter')
  expect(ipcApi.request).not.toHaveBeenCalled()
  await user.type(input, '7')
  vi.mocked(ipcApi.request).mockResolvedValueOnce({
    trace: [
      { step: 'callback', elapsedMs: 10, detail: '{"method":"host.double","value":7}' },
      { step: 'response', elapsedMs: 20, detail: '15' }
    ],
    report: ''
  })
  await user.click(screen.getByRole('button', { name: 'Send request' }))
  expect(ipcApi.request).toHaveBeenLastCalledWith('sandbox.request', { kind: 'rpc', value: 7, allowCallback: true })
  expect(await screen.findByText('15')).toBeVisible()
  expect(screen.getByText('1. Sandbox → host callback')).toBeVisible()
  await user.click(screen.getByRole('checkbox', { name: 'Allow sandbox callback to host.double' }))
  vi.mocked(ipcApi.request).mockResolvedValueOnce({
    trace: [{ step: 'error', elapsedMs: 10, detail: 'Access denied' }],
    report: ''
  })
  await user.click(screen.getByRole('button', { name: 'Send request' }))
  expect(ipcApi.request).toHaveBeenLastCalledWith('sandbox.request', { kind: 'rpc', value: 7, allowCallback: false })
  expect(await screen.findByText('Access denied')).toBeVisible()
  expect(screen.queryByText('15')).not.toBeInTheDocument()
})

it('sends the edited URL and exact allowlist, including an empty deny-all list', async () => {
  const user = userEvent.setup()
  render(<SandboxDialog open onOpenChange={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Network allowlist' }))
  const url = screen.getByLabelText('Request URL')
  const origins = screen.getByLabelText('Allowlist (one origin URL per line)')
  await user.clear(url)
  await user.type(url, 'http://127.0.0.1:8765/query?q=hello')
  await user.clear(origins)
  await user.type(origins, 'http://127.0.0.1:8765\nhttps://example.com')
  vi.mocked(ipcApi.request).mockResolvedValueOnce({
    trace: [{ step: 'response', elapsedMs: 2, detail: '{"status":200}' }],
    report: ''
  })
  await user.click(screen.getByRole('button', { name: 'Send request' }))
  expect(ipcApi.request).toHaveBeenLastCalledWith('sandbox.request', {
    kind: 'network',
    url: 'http://127.0.0.1:8765/query?q=hello',
    allowedOrigins: ['http://127.0.0.1:8765', 'https://example.com']
  })
  expect(await screen.findByText('{"status":200}')).toBeVisible()
  await user.clear(origins)
  expect(screen.queryByText('{"status":200}')).not.toBeInTheDocument()
  vi.mocked(ipcApi.request).mockResolvedValueOnce({
    trace: [{ step: 'response', elapsedMs: 2, detail: '{"status":403}' }],
    report: ''
  })
  await user.click(screen.getByRole('button', { name: 'Send request' }))
  expect(ipcApi.request).toHaveBeenLastCalledWith('sandbox.request', {
    kind: 'network',
    url: 'http://127.0.0.1:8765/query?q=hello',
    allowedOrigins: []
  })
  expect(await screen.findByText('{"status":403}')).toBeVisible()
})
