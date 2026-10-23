import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { useFileEditSession } from '@renderer/hooks/useFileEditSession'
import { fileEditRequestSchemas } from '@shared/ipc/schemas/fileEdit'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { createEditTransport } from '../../../../tests/helpers/file/editTransport'
import { FileEditSessionProvider } from '../FileEditSessionProvider'

const ipc = vi.hoisted(() => ({ request: vi.fn(), on: vi.fn(() => () => {}) }))
vi.mock('@renderer/ipc', () => ({ ipcApi: ipc }))
const handle = { kind: 'path', path: AbsoluteFilePathSchema.parse('/notes/A.md') } as const
let disk: string
let fail: boolean

function Editor() {
  const session = useFileEditSession(handle, 'notes')
  return (
    <textarea
      aria-label="draft"
      value={session.draft}
      readOnly={session.readOnly}
      onChange={(event) => session.setDraft(event.target.value)}
    />
  )
}

function View({ visible }: { visible: boolean }) {
  return <FileEditSessionProvider>{visible && <Editor />}</FileEditSessionProvider>
}

beforeEach(() => {
  disk = 'original'
  fail = false
  ipc.request.mockImplementation(
    createEditTransport(async (route, input) => {
      if (route === 'file.edit.read')
        return { content: new TextEncoder().encode(disk), version: { mtime: 1, size: disk.length } }
      if (route === 'file.edit.write') {
        if (fail) throw new Error('disk full')
        disk = new TextDecoder().decode(fileEditRequestSchemas[route].input.parse(input).data)
        return { mtime: 2, size: disk.length }
      }
      throw new Error(`Unexpected ${route}`)
    })
  )
})
afterEach(cleanup)

// A failed save after view detachment must remain recoverable from the window surface.
it.each(['retry', 'discard'] as const)('recovers a detached failed draft through %s', async (action) => {
  const view = render(<View visible />)
  const editor = screen.getByRole('textbox', { name: 'draft' })
  await waitFor(() => expect(editor).toHaveValue('original'))
  fireEvent.change(editor, { target: { value: 'changed' } })
  fail = true
  view.rerender(<View visible={false} />)
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('/notes/A.md')
  await waitFor(() => expect(screen.getByRole('button', { name: '重试' })).toBeEnabled())
  expect(disk).toBe('original')
  fail = false
  fireEvent.click(screen.getByRole('button', { name: action === 'retry' ? '重试' : '放弃修改' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(disk).toBe(action === 'retry' ? 'changed' : 'original')
  view.rerender(<View visible />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'draft' })).toHaveValue(disk))
})
