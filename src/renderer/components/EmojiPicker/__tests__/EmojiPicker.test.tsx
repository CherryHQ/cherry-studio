import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EmojiPicker } from '..'

const emojiPickerPropsMock = vi.hoisted((): { value: any } => ({ value: undefined }))
const i18nLanguageMock = vi.hoisted(() => ({ value: 'en-US' }))

vi.mock('emoji-picker-react', () => {
  const EmojiPickerReact = (props) => {
    emojiPickerPropsMock.value = props

    return (
      <div className={props.className} data-emoji-version={props.emojiVersion} data-testid="emoji-picker-react">
        {!props.searchDisabled ? (
          <input aria-label={props.searchPlaceholder} placeholder={props.searchPlaceholder} />
        ) : null}
        <div aria-label="Emoji categories" role="tablist" />
        {props.previewConfig?.showPreview ? <div data-testid="emoji-preview">preview</div> : null}
        {!props.skinTonesDisabled ? (
          <button type="button" data-testid="skin-tone-picker">
            skin tone
          </button>
        ) : null}
        <button type="button" onClick={(event) => props.onEmojiClick({ emoji: '🤖' }, event)}>
          Pick robot
        </button>
      </div>
    )
  }

  return {
    default: EmojiPickerReact,
    Categories: {
      SUGGESTED: 'suggested',
      SMILEYS_PEOPLE: 'smileys_people',
      ANIMALS_NATURE: 'animals_nature',
      FOOD_DRINK: 'food_drink',
      TRAVEL_PLACES: 'travel_places',
      ACTIVITIES: 'activities',
      OBJECTS: 'objects',
      SYMBOLS: 'symbols',
      FLAGS: 'flags'
    },
    EmojiStyle: { NATIVE: 'native' },
    SkinTonePickerLocation: { SEARCH: 'SEARCH' },
    SuggestionMode: { RECENT: 'recent' },
    Theme: { AUTO: 'auto' }
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: i18nLanguageMock.value }
  })
}))

afterEach(async () => {
  const { MockUseCacheUtils } = await import('../../../../../tests/__mocks__/renderer/useCache')
  MockUseCacheUtils.resetMocks()
})

describe('EmojiPicker', () => {
  beforeEach(() => {
    i18nLanguageMock.value = 'en-US'
    emojiPickerPropsMock.value = undefined
  })

  it('renders emoji-picker-react with search disabled and category navigation enabled', () => {
    render(<EmojiPicker onEmojiClick={vi.fn()} />)

    expect(screen.getByTestId('emoji-picker-react')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('emoji_picker.search')).not.toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Emoji categories' })).toBeInTheDocument()
    expect(emojiPickerPropsMock.value.searchDisabled).toBe(true)
    expect(emojiPickerPropsMock.value.searchPlaceholder).toBeUndefined()
    expect(emojiPickerPropsMock.value.emojiData).toBeUndefined()
    expect(emojiPickerPropsMock.value.categories.map((item: any) => item.category)).toEqual([
      'suggested',
      'smileys_people',
      'animals_nature',
      'food_drink',
      'travel_places',
      'activities',
      'objects',
      'symbols',
      'flags'
    ])
    expect(Object.keys(emojiPickerPropsMock.value.categoryIcons)).toEqual([
      'suggested',
      'smileys_people',
      'animals_nature',
      'food_drink',
      'travel_places',
      'activities',
      'objects',
      'symbols',
      'flags'
    ])
    expect(emojiPickerPropsMock.value.categoryIcons.suggested.props.className).toBe('size-4.5')
  })

  it('uses compact dimensions and Cherry theme variables', () => {
    const { container } = render(<EmojiPicker onEmojiClick={vi.fn()} />)

    expect(container.firstElementChild).toHaveClass(
      'h-88',
      'w-80',
      'max-h-[min(22rem,calc(100vh-6rem))]',
      'max-w-[calc(100vw-2rem)]'
    )

    expect(emojiPickerPropsMock.value.width).toBe('100%')
    expect(emojiPickerPropsMock.value.height).toBe('100%')
    expect(emojiPickerPropsMock.value.className).toBe('cherry-emoji-picker-react')
    expect(emojiPickerPropsMock.value.style).toMatchObject({
      '--epr-bg-color': 'var(--color-card)',
      '--epr-picker-border-color': 'transparent',
      '--epr-highlight-color': 'var(--color-primary)',
      '--epr-hover-bg-color-reduced-opacity': 'var(--color-accent)',
      '--epr-category-label-text-color': 'var(--color-card-foreground)',
      '--epr-category-navigation-button-size': '24px',
      '--epr-emoji-size': '24px',
      '--epr-emoji-hover-color': 'var(--color-accent)',
      '--epr-emoji-variation-indicator-color': 'var(--color-border)',
      '--epr-emoji-variation-indicator-color-hover': 'var(--color-foreground)'
    })
  })

  it('keeps category title labels compact through scoped picker styles', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/components/EmojiPicker/EmojiPicker.css'), 'utf-8')

    expect(css).toContain('.cherry-emoji-picker-react .epr-emoji-category-label')
    expect(css).toContain('font-size: 13px')
    expect(css).toContain('padding-left: calc(var(--epr-horizontal-padding) + var(--epr-emoji-padding))')
    expect(css).toContain('.cherry-emoji-picker-react .epr-cat-btn:focus::before')
    expect(css).toContain('--cherry-emoji-category-focus-size: 30px')
    expect(css).toContain('top: 50%')
    expect(css).toContain('left: 50%')
    expect(css).toContain('width: var(--cherry-emoji-category-focus-size)')
    expect(css).toContain('height: var(--cherry-emoji-category-focus-size)')
    expect(css).toContain('transform: translate(-50%, -50%)')
  })

  it('uses native Emoji 13, auto theme, no preview, and no skin tone picker', () => {
    render(<EmojiPicker onEmojiClick={vi.fn()} />)

    expect(emojiPickerPropsMock.value.emojiStyle).toBe('native')
    expect(emojiPickerPropsMock.value.emojiVersion).toBe('13.0')
    expect(emojiPickerPropsMock.value.theme).toBe('auto')
    expect(emojiPickerPropsMock.value.previewConfig).toEqual({ showPreview: false })
    expect(emojiPickerPropsMock.value.skinTonesDisabled).toBe(true)
    expect(screen.queryByTestId('emoji-preview')).not.toBeInTheDocument()
    expect(screen.queryByTestId('skin-tone-picker')).not.toBeInTheDocument()
  })

  it('does not load localized emoji search data when the app language changes', () => {
    i18nLanguageMock.value = 'zh-CN'

    render(<EmojiPicker onEmojiClick={vi.fn()} />)

    expect(emojiPickerPropsMock.value.emojiData).toBeUndefined()
  })

  it('calls onEmojiClick and updates Cherry recent emojis when an emoji is picked', async () => {
    const { MockUseCacheUtils } = await import('../../../../../tests/__mocks__/renderer/useCache')
    MockUseCacheUtils.setPersistCacheValue('ui.emoji.recently_used', ['🧠', '📁'])

    const handleClick = vi.fn()
    render(<EmojiPicker onEmojiClick={handleClick} />)

    fireEvent.click(screen.getByRole('button', { name: 'Pick robot' }))
    expect(handleClick).toHaveBeenCalledWith('🤖')
    expect(MockUseCacheUtils.getPersistCacheValue('ui.emoji.recently_used')).toEqual(['🤖', '🧠', '📁'])
  })
})
