import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import enUS from '@renderer/i18n/locales/en-us.json'

vi.mock('@renderer/services/toast', (importOriginal) => importOriginal())
vi.mock('@cherrystudio/ui', async () => import('@cherrystudio/ui/components/primitives/toast'))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      (enUS[key as keyof typeof enUS] ?? key).replace(/{{(\w+)}}/g, (_, name: string) => values?.[name] ?? '')
  })
}))

import ToastHost from '@renderer/components/ToastHost'
import { toast } from '@renderer/services/toast'

import { useWebSearchFallbackNotice } from '../useWebSearchFallbackNotice'

function Notice() {
  useWebSearchFallbackNotice()
  return <ToastHost />
}

afterEach(() => {
  toast.closeAll()
  vi.restoreAllMocks()
})

describe('web search fallback notice', () => {
  it('shows provider names, deduplicates by triple and unsubscribes', async () => {
    const listeners = new Set<(payload: unknown) => void>()
    vi.spyOn(window.api.ipcApi, 'on').mockImplementation((_event, callback) => {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    })
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const view = render(<Notice />)
    const emit = (payload: unknown) => act(() => listeners.forEach((listener) => listener(payload)))
    const payload = { primaryProviderId: 'deepseek', fallbackProviderId: 'exa-mcp', capability: 'searchKeywords' }
    emit(payload)
    emit(payload)
    const firstNotice = await screen.findAllByText(/DeepSeek.*ExaMCP/)
    expect(firstNotice).toHaveLength(1)
    const firstText = firstNotice[0].textContent
    now += 9_000
    emit(payload)
    expect(screen.getAllByText(/DeepSeek.*ExaMCP/)).toHaveLength(1)
    now += 1_000
    emit({ ...payload, query: 'secret query', url: 'https://secret.example' })
    const notices = await screen.findAllByText(/DeepSeek.*ExaMCP/)
    expect(notices).toHaveLength(2)
    expect(notices[1].textContent).toBe(firstText)
    emit({ ...payload, primaryProviderId: 'jina' })
    expect(await screen.findByText(/Jina.*ExaMCP/i)).toBeTruthy()
    emit({ ...payload, fallbackProviderId: 'fetch' })
    expect(await screen.findByText(/DeepSeek.*Fetch/i)).toBeTruthy()
    emit({ ...payload, capability: 'fetchUrls' })
    expect(await screen.findAllByText(/DeepSeek.*ExaMCP/)).toHaveLength(3)
    view.unmount()
    expect(listeners.size).toBe(0)
  })
})
