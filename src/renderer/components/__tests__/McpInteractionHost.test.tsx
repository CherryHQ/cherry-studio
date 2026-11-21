import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, assert, beforeAll, expect, it, vi } from 'vitest'

vi.unmock('@cherrystudio/ui')

import { McpInteractionHost } from '../McpInteractionHost'

beforeAll(async () => {
  await i18n.changeLanguage('en-US')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('edits and submits a literal reserved form field without inheriting a default or changing the value prototype', async () => {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  vi.spyOn(window.api.ipcApi, 'on').mockImplementation((event, listener) => {
    const handlers = listeners.get(event) ?? new Set<(payload: unknown) => void>()
    listeners.set(event, handlers)
    handlers.add(listener)
    return () => {
      handlers.delete(listener)
    }
  })
  const request = vi.spyOn(window.api.ipcApi, 'request').mockResolvedValue({ ok: true, data: undefined })
  const user = userEvent.setup()
  render(<McpInteractionHost />)

  act(() => {
    for (const listener of listeners.get('mcp.interaction.requested') ?? []) {
      listener({
        serverId: 'form-server',
        serverName: 'Form server',
        requestId: 'reserved-field-form',
        topicId: 'topic-1',
        kind: 'elicitation',
        payload: {
          params: {
            message: 'Enter the requested value',
            requestedSchema: JSON.parse(
              '{"type":"object","properties":{"__proto__":{"type":"string","title":"Reserved field"}},"required":["__proto__"]}'
            )
          }
        }
      })
    }
  })

  const input = await screen.findByRole('textbox', { name: 'Reserved field *' })
  expect(input).toHaveValue('')
  await user.type(input, 'literal')
  await user.click(screen.getByRole('button', { name: i18n.t('common.confirm') }))

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith('mcp.interaction.respond', {
      requestId: 'reserved-field-form',
      decision: 'accept',
      value: JSON.parse('{"__proto__":"literal"}')
    })
  })
  const submitted = request.mock.calls.find(([route]) => route === 'mcp.interaction.respond')?.[1]
  assert(submitted && typeof submitted === 'object' && 'value' in submitted)
  assert(submitted.value && typeof submitted.value === 'object')
  expect(Object.getOwnPropertyDescriptor(submitted.value, '__proto__')?.value).toBe('literal')
  expect(Object.getPrototypeOf(submitted.value)).toBe(Object.prototype)
})
