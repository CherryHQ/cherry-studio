import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { OcrStatusIcon } from '../components/OcrStatusIcon'

const mocks = vi.hoisted(() => ({ request: vi.fn(), openSettingsTab: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openSettingsTab: mocks.openSettingsTab }))

describe('OcrStatusIcon', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    mocks.request.mockReset().mockResolvedValue(undefined)
    mocks.openSettingsTab.mockReset()
  })

  it('offers a manual trigger when auto OCR is off, instead of doing nothing', async () => {
    const onTriggerOcr = vi.fn()
    render(<OcrStatusIcon status="pending" autoOcr={false} onTriggerOcr={onTriggerOcr} />)

    await userEvent.click(screen.getByRole('button', { name: 'Recognize text' }))

    // With auto OCR off this is the ONLY way in; a non-interactive icon here leaves
    // those users unable to recognize anything at all.
    expect(onTriggerOcr).toHaveBeenCalledTimes(1)
  })

  it('copies the recognized text when the finished icon is clicked', async () => {
    const onCopyText = vi.fn()
    render(<OcrStatusIcon status="done" onCopyText={onCopyText} />)

    await userEvent.click(screen.getByRole('button', { name: 'Copy all text, or select it on screen' }))

    expect(onCopyText).toHaveBeenCalledTimes(1)
  })

  it('keeps the in-progress and failed icons inert', async () => {
    const onTriggerOcr = vi.fn()
    const onCopyText = vi.fn()
    const { rerender } = render(
      <OcrStatusIcon status="recognizing" onTriggerOcr={onTriggerOcr} onCopyText={onCopyText} />
    )
    await userEvent.click(screen.getByRole('button'))

    rerender(<OcrStatusIcon status="error" onTriggerOcr={onTriggerOcr} onCopyText={onCopyText} />)
    await userEvent.click(screen.getByRole('button'))

    // Both render a real button so the tooltip has a trigger; wiring one shared
    // onClick across the states would start a recognition or a copy from either.
    expect(onTriggerOcr).not.toHaveBeenCalled()
    expect(onCopyText).not.toHaveBeenCalled()
  })

  it('shows the recognition failure rather than reporting no text', () => {
    render(<OcrStatusIcon status="error" errorMessage="worker died" />)

    expect(screen.getByRole('button', { name: 'worker died' })).toBeInTheDocument()
  })

  it('falls back to a generic message when the failure carries none', () => {
    render(<OcrStatusIcon status="error" />)

    expect(screen.getByRole('button', { name: 'Text recognition failed' })).toBeInTheDocument()
  })

  it('dismisses the overlay before navigating to the model settings', async () => {
    const order: string[] = []
    mocks.request.mockImplementation((route: string) => {
      order.push(`ipc:${route}`)
      return Promise.resolve(undefined)
    })
    mocks.openSettingsTab.mockImplementation((path: string) => order.push(`nav:${path}`))
    render(<OcrStatusIcon status="unavailable" />)

    await userEvent.click(screen.getByRole('button', { name: /local OCR model is not ready/i }))

    // Order is the whole point: the overlay is a screen-saver-level always-on-top
    // full-screen window, so navigating first hides the settings page behind it.
    expect(order).toEqual(['ipc:screenshot.cancel', 'nav:/settings/local-models'])
  })

  it('renders nothing while idle, so the toolbar has no dead affordance', () => {
    render(<OcrStatusIcon status="idle" />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('greys out the affordance while annotating, whatever the recognition is doing', async () => {
    const onCopyText = vi.fn()
    render(<OcrStatusIcon status="done" disabled onCopyText={onCopyText} />)

    const button = screen.getByRole('button', { name: 'Text recognition is unavailable while annotating' })
    await userEvent.click(button)

    // `disabled` is orthogonal to the six statuses: a `done` recognition must still
    // grey out here, or the text layer steals the annotation tools' pointer events.
    expect(button).toBeDisabled()
    expect(onCopyText).not.toHaveBeenCalled()
  })
})
