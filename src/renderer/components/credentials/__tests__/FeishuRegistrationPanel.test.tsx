import { act, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'

import { FeishuRegistrationPanel } from '../FeishuRegistrationPanel'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function Harness() {
  const [saved, setSaved] = useState<string | null>(null)
  return saved ? (
    <p>Saved {saved}</p>
  ) : (
    <FeishuRegistrationPanel domain="feishu" purpose="channel" onRegistered={(app) => setSaved(app.id)} />
  )
}

// Catch late completion binding a different form and accidental browser launches on mount.
describe('Feishu registration panel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows a QR authorization link and then the saved application', async () => {
    const gate = Promise.withResolvers<unknown>()
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'feishu.registration.begin')
        return { verificationUri: 'https://accounts.feishu.cn/verify' } as never
      if (route === 'feishu.registration.complete') return gate.promise as never
      return undefined as never
    })
    render(<Harness />)
    expect(await screen.findByRole('button', { name: 'chat.artifacts.button.openExternal' })).toBeVisible()
    await act(async () => gate.resolve({ id: 'saved-app', kind: 'application', status: 'available' }))
    expect(await screen.findByText('Saved saved-app')).toBeVisible()
  })

  it('cancels by request ID even if the user closes the panel before begin returns', async () => {
    const gate = Promise.withResolvers<unknown>()
    const cancelled: string[] = []
    let requestId: string | undefined
    const bound: string[] = []
    vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
      if (route === 'feishu.registration.begin') {
        requestId = (input as { requestId: string }).requestId
        return gate.promise as never
      }
      if (route === 'feishu.registration.cancel')
        cancelled.push((input as { registrationSessionId: string }).registrationSessionId)
      return undefined as never
    })
    const { unmount } = render(
      <FeishuRegistrationPanel
        domain="feishu"
        purpose="channel"
        onRegistered={(app) => {
          bound.push(app.id)
        }}
      />
    )
    await waitFor(() => expect(requestId).toBeDefined())
    unmount()
    await act(async () => gate.resolve({ verificationUri: 'https://accounts.feishu.cn/late' }))
    expect(cancelled).toEqual([requestId])
    expect(bound).toEqual([])
  })
})
