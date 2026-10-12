import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { APPLE_ASR_MODEL_ID, VoiceResourceOperation } from '@shared/ai/localVoice'

vi.unmock('@cherrystudio/ui')
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  )
}))

import SystemVoiceResources from '../SystemVoiceResources'

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  MockUsePreferenceUtils.resetMocks()
  request.mockReset().mockImplementation(async (route) => {
    if (route === 'ai.voice.models.list')
      return { models: [{ id: APPLE_ASR_MODEL_ID, resourceOperations: [VoiceResourceOperation.InstallLocale] }] }
    if (route === 'ai.transcription.locales.list') return { supported: ['en-US', 'zh-CN'], installed: [] }
    if (route === 'ai.voice.model.status') return { status: 'not_installed', reason: 'asset_required' }
    return undefined
  })
})

describe('system voice resources', () => {
  it('installs only on demand and keeps voice preferences unchanged', async () => {
    let complete!: () => void
    let installed = false
    const original = request.getMockImplementation()!
    request.mockImplementation(async (route, input) => {
      if (route === 'ai.transcription.asset.install')
        return new Promise<void>((resolve) => {
          complete = () => {
            installed = true
            resolve()
          }
        })
      if (route === 'ai.voice.model.status' && installed) return { status: 'ready' }
      return original(route, input)
    })
    render(<SystemVoiceResources />)
    const install = await screen.findByRole('button', { name: 'Install' })
    await waitFor(() => expect(install).toBeEnabled())
    expect(request.mock.calls.some(([route]) => route === 'ai.transcription.asset.install')).toBe(false)
    await userEvent.setup().click(install)
    expect(screen.getByRole('combobox', { name: 'Recognition language' })).toBeDisabled()
    await act(async () => complete())
    expect(await screen.findByText('Ready')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.recognition.language')).toBeNull()
    expect(screen.getByRole('link', { name: 'Return to voice settings' })).toHaveAttribute('href', '/settings/voice')
  })

  it('keeps an installation error visible and permits another attempt', async () => {
    const original = request.getMockImplementation()!
    request.mockImplementation(async (route, input) => {
      if (route === 'ai.transcription.asset.install') throw Error('installation failed')
      return original(route, input)
    })
    render(<SystemVoiceResources />)
    const install = await screen.findByRole('button', { name: 'Install' })
    await waitFor(() => expect(install).toBeEnabled())
    await userEvent.setup().click(install)
    expect(await screen.findByRole('alert')).toHaveTextContent('The voice operation failed. Try again.')
    expect(screen.getByRole('button', { name: 'Install' })).toBeEnabled()
  })
})
