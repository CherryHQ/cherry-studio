import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { emojiToCountryCode } from '../FlagEmoji'

describe('emojiToCountryCode', () => {
  it('converts standard Regional Indicator emoji to country code', () => {
    expect(emojiToCountryCode('🇨🇳')).toBe('cn')
    expect(emojiToCountryCode('🇺🇸')).toBe('us')
    expect(emojiToCountryCode('🇬🇧')).toBe('gb')
    expect(emojiToCountryCode('🇯🇵')).toBe('jp')
    expect(emojiToCountryCode('🇩🇪')).toBe('de')
    expect(emojiToCountryCode('🇫🇷')).toBe('fr')
  })

  it('returns empty string for non-Regional Indicator emoji', () => {
    expect(emojiToCountryCode('🌐')).toBe('')
    expect(emojiToCountryCode('🏳️')).toBe('')
    expect(emojiToCountryCode('😀')).toBe('')
    expect(emojiToCountryCode('🚀')).toBe('')
  })

  it('returns empty string for empty input', () => {
    expect(emojiToCountryCode('')).toBe('')
  })
})

describe('FlagEmoji component', () => {
  it('renders emoji in a span on non-Windows platforms', async () => {
    const FlagEmoji = (await import('../FlagEmoji')).default
    const { container } = render(<FlagEmoji emoji="🇨🇳" />)
    const span = container.querySelector('span.country-flag-font')
    expect(span).toBeTruthy()
    expect(span!.textContent).toBe('🇨🇳')
  })

  it('applies custom style to the span', async () => {
    const FlagEmoji = (await import('../FlagEmoji')).default
    const { container } = render(<FlagEmoji emoji="🇺🇸" style={{ marginRight: 8 }} />)
    const span = container.querySelector('span.country-flag-font') as HTMLElement
    expect(span.style.marginRight).toBe('8px')
  })

  it('renders fallback span for non-Regional Indicator emoji on non-Windows', async () => {
    const FlagEmoji = (await import('../FlagEmoji')).default
    const { container } = render(<FlagEmoji emoji="🏳️" />)
    const span = container.querySelector('span.country-flag-font')
    expect(span).toBeTruthy()
    expect(span!.textContent).toBe('🏳️')
  })
})

describe('FlagEmoji on Windows', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders SVG img for known flag emoji', async () => {
    vi.resetModules()
    vi.doMock('@renderer/config/constant', () => ({ isWin: true }))
    const { default: FlagEmoji } = await import('../FlagEmoji')
    const { container } = render(<FlagEmoji emoji="🇨🇳" size={24} />)
    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    expect(img!.alt).toBe('🇨🇳')
    expect(img!.style.width).toBe('24px')
    expect(img!.style.height).toBe('18px')
  })

  it('renders fallback span for unknown flag emoji on Windows', async () => {
    vi.resetModules()
    vi.doMock('@renderer/config/constant', () => ({ isWin: true }))
    const { default: FlagEmoji } = await import('../FlagEmoji')
    const { container } = render(<FlagEmoji emoji="🏳️" />)
    const span = container.querySelector('span.country-flag-font')
    expect(span).toBeTruthy()
    expect(span!.textContent).toBe('🏳️')
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders fallback span for non-Regional Indicator emoji on Windows', async () => {
    vi.resetModules()
    vi.doMock('@renderer/config/constant', () => ({ isWin: true }))
    const { default: FlagEmoji } = await import('../FlagEmoji')
    const { container } = render(<FlagEmoji emoji="🌐" />)
    const span = container.querySelector('span.country-flag-font')
    expect(span).toBeTruthy()
    expect(span!.textContent).toBe('🌐')
    expect(container.querySelector('img')).toBeNull()
  })
})
