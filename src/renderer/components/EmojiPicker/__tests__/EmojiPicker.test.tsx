import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EmojiPicker } from '..'

const emojiPickerPropsMock = vi.hoisted((): { value: any } => ({ value: undefined }))
const i18nLanguageMock = vi.hoisted(() => ({ value: 'en-US' }))
const zhEmojiDataMock = vi.hoisted(() => ({ categories: { smileys_people: { name: '表情' } }, emojis: {} }))

vi.mock('emoji-picker-react/dist/data/emojis-zh', () => ({
  default: zhEmojiDataMock
}))

vi.mock('emoji-picker-react', () => {
  const EmojiPickerReact = (props) => {
    emojiPickerPropsMock.value = props

    return (
      <div className={props.className} data-emoji-version={props.emojiVersion} data-testid="emoji-picker-react">
        {!props.searchDisabled ? (
          <input aria-label="Type to search for an emoji" placeholder={props.searchPlaceholder} />
        ) : null}
        <div aria-label="Emoji categories" role="tablist" />
        {props.previewConfig?.showPreview ? <div data-testid="emoji-preview">preview</div> : null}
        {!props.skinTonesDisabled ? (
          <button type="button" data-testid="skin-tone-picker">
            skin tone
          </button>
        ) : null}
        <div data-testid="emoji-picker-categories">
          {props.categories.map((item: any) => (
            <span key={item.category} data-category={item.category}>
              {item.icon}
              {item.name}
            </span>
          ))}
        </div>
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

  it('enables localized vendor search with autofocus and category navigation', () => {
    render(<EmojiPicker onEmojiClick={vi.fn()} />)

    expect(screen.getByTestId('emoji-picker-react')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('emoji_picker.search')).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Emoji categories' })).toBeInTheDocument()
    expect(emojiPickerPropsMock.value).toMatchObject({
      autoFocusSearch: true,
      searchClearButtonLabel: 'common.clear',
      searchDisabled: false,
      searchPlaceholder: 'emoji_picker.search'
    })
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
    expect(emojiPickerPropsMock.value.categoryIcons).toBeUndefined()
    expect(emojiPickerPropsMock.value.categories.map((item: any) => item.icon.props.className)).toEqual(
      Array.from({ length: 9 }, () => 'size-4.5')
    )
    expect(screen.getByTestId('emoji-picker-categories')).toHaveTextContent('emoji_picker.categories.recent')
    expect(screen.getByTestId('emoji-picker-categories')).toHaveTextContent('emoji_picker.categories.smileys_emotion')
  })

  it('uses compact dimensions and Cherry theme variables', () => {
    const { container } = render(<EmojiPicker onEmojiClick={vi.fn()} />)

    expect(container.firstElementChild).toHaveClass(
      'h-88',
      'w-80',
      'max-h-[min(22rem,calc(100vh-6rem))]',
      'max-w-[calc(100vw-2rem)]',
      'bg-popover',
      'text-popover-foreground'
    )

    expect(emojiPickerPropsMock.value.width).toBe('100%')
    expect(emojiPickerPropsMock.value.height).toBe('100%')
    expect(emojiPickerPropsMock.value.className).toBe('cherry-emoji-picker-react')
    expect(emojiPickerPropsMock.value.style).toMatchObject({
      '--epr-bg-color': 'var(--color-popover)',
      '--epr-picker-border-color': 'transparent',
      '--epr-highlight-color': 'var(--color-primary)',
      '--epr-hover-bg-color-reduced-opacity': 'var(--color-accent)',
      '--epr-text-color': 'var(--color-popover-foreground)',
      '--epr-category-label-bg-color': 'var(--color-popover)',
      '--epr-category-label-text-color': 'var(--color-popover-foreground)',
      '--epr-search-input-bg-color': 'var(--color-background)',
      '--epr-search-input-bg-color-active': 'var(--color-background)',
      '--epr-search-input-text-color': 'var(--color-foreground)',
      '--epr-search-input-placeholder-color': 'var(--color-foreground-muted)',
      '--epr-search-border-color': 'var(--color-input)',
      '--epr-search-border-color-active': 'var(--color-ring)',
      '--epr-header-padding': '10px var(--epr-horizontal-padding) 8px',
      '--epr-emoji-hover-color': 'var(--color-accent)',
      '--epr-emoji-variation-indicator-color': 'var(--color-border)',
      '--epr-emoji-variation-indicator-color-hover': 'var(--color-foreground)'
    })

    for (const property of [
      '--epr-horizontal-padding',
      '--epr-category-navigation-button-size',
      '--epr-emoji-size',
      '--epr-emoji-padding'
    ]) {
      expect(emojiPickerPropsMock.value.style).not.toHaveProperty(property)
    }
  })

  it('passes category icons through the public categories configuration', () => {
    render(<EmojiPicker onEmojiClick={vi.fn()} />)

    expect(emojiPickerPropsMock.value.categories.every((item: any) => item.icon)).toBe(true)
    expect(emojiPickerPropsMock.value.categoryIcons).toBeUndefined()
  })

  it('keeps category label paint aligned with its sticky layout box', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/components/EmojiPicker/EmojiPicker.css'), 'utf-8')

    expect(css).not.toMatch(/\.cherry-emoji-picker-react \.epr-emoji-category-label\s*\{[^}]*transform:/)
  })

  it('applies the category label paint guard on every platform', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/components/EmojiPicker/EmojiPicker.css'), 'utf-8')
    const categoryLabelRule = css.match(
      /(?:^|\n)\.cherry-emoji-picker-react \.epr-emoji-category-label\s*\{([^}]*)\}/
    )?.[1]

    expect(categoryLabelRule).toContain('backdrop-filter: none')
    expect(categoryLabelRule).toContain('box-shadow: 0 -1px 0 var(--epr-category-label-bg-color)')
    expect(categoryLabelRule).toContain('font-size: 14px')
    expect(categoryLabelRule).toContain('font-weight: var(--font-weight-regular)')
  })

  it('does not keep a Windows-only category label override', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/components/EmojiPicker/EmojiPicker.css'), 'utf-8')

    expect(css).not.toContain("body[os='windows'] .cherry-emoji-picker-react .epr-emoji-category-label")
  })

  it('centers custom category icons inside their buttons', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/components/EmojiPicker/EmojiPicker.css'), 'utf-8')
    const categoryButtonRule = css.match(/\.cherry-emoji-picker-react \.epr-cat-btn\s*\{([^}]*)\}/)?.[1]

    expect(categoryButtonRule).toContain('display: flex')
    expect(categoryButtonRule).toContain('align-items: center')
    expect(categoryButtonRule).toContain('justify-content: center')
  })

  it('centers the category selection ring on the custom icon', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/components/EmojiPicker/EmojiPicker.css'), 'utf-8')
    const selectionRingRule = css.match(/\.cherry-emoji-picker-react \.epr-cat-btn:focus::before\s*\{([^}]*)\}/)?.[1]

    expect(selectionRingRule).toContain('top: 50%')
    expect(selectionRingRule).toContain('right: auto')
    expect(selectionRingRule).toContain('bottom: auto')
    expect(selectionRingRule).toContain('left: 50%')
    expect(selectionRingRule).toContain('width: var(--epr-category-navigation-button-size)')
    expect(selectionRingRule).toContain('height: var(--epr-category-navigation-button-size)')
    expect(selectionRingRule).toContain('transform: translate(-50%, -50%)')
  })

  it('uses the bundled country flag font for native emojis on Windows', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/components/EmojiPicker/EmojiPicker.css'), 'utf-8')
    const windowsNativeEmojiRule = css.match(
      /body\[os='windows'\] \.cherry-emoji-picker-react \.epr-emoji-native\s*\{([^}]*)\}/
    )?.[1]

    expect(windowsNativeEmojiRule).toMatch(/font-family:\s*'Twemoji Country Flags'/)
    expect(windowsNativeEmojiRule).toContain('!important')
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

  it('loads localized emoji data when the app language changes', async () => {
    i18nLanguageMock.value = 'zh-CN'

    render(<EmojiPicker onEmojiClick={vi.fn()} />)

    await waitFor(() => {
      expect(emojiPickerPropsMock.value.emojiData).toBe(zhEmojiDataMock)
    })
  })

  it('does not render Cherry recent emojis outside the third-party picker', async () => {
    const { MockUseCacheUtils } = await import('../../../../../tests/__mocks__/renderer/useCache')
    MockUseCacheUtils.setPersistCacheValue('ui.emoji.recently_used', ['🧠', '📁'])

    render(<EmojiPicker onEmojiClick={vi.fn()} />)

    expect(screen.getByTestId('emoji-picker-categories')).toHaveTextContent('emoji_picker.categories.recent')
    expect(screen.queryByRole('button', { name: '🧠' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '📁' })).not.toBeInTheDocument()
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
