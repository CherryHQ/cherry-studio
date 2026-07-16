import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EmojiPicker } from '..'

const emojiPickerPropsMock = vi.hoisted((): { value: any } => ({ value: undefined }))
const i18nLanguageMock = vi.hoisted(() => ({ value: 'en-US' }))
const require = createRequire(import.meta.url)
const loadSourceEmojiRecords = (locale: 'en' | 'zh') =>
  JSON.parse(readFileSync(require.resolve(`emoji-picker-element-data/${locale}/cldr/data.json`), 'utf-8')) as unknown[]
const sourceEmojiRecords = {
  en: loadSourceEmojiRecords('en'),
  zh: loadSourceEmojiRecords('zh')
}

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
          {props.suggestedEmojis?.map((emoji: string) => (
            <button key={emoji} type="button" aria-label={emoji}>
              {emoji}
            </button>
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
  vi.unstubAllGlobals()
})

describe('EmojiPicker', () => {
  beforeEach(() => {
    i18nLanguageMock.value = 'en-US'
    emojiPickerPropsMock.value = undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const records = String(input).includes('/zh/') ? sourceEmojiRecords.zh : sourceEmojiRecords.en
        return {
          json: async () => records,
          ok: true,
          status: 200,
          statusText: 'OK'
        } as Response
      })
    )
  })

  const renderResolvedPicker = async (onEmojiClick = vi.fn()) => {
    const view = render(<EmojiPicker onEmojiClick={onEmojiClick} />)
    await screen.findByTestId('emoji-picker-react')
    return view
  }

  it('renders a fixed-size loading boundary before the picker implementation resolves', () => {
    render(<EmojiPicker onEmojiClick={vi.fn()} />)

    expect(screen.getByRole('status')).toHaveClass(
      'h-88',
      'w-80',
      'max-h-[min(22rem,calc(100vh-6rem))]',
      'max-w-[calc(100vw-2rem)]'
    )
  })

  it('enables localized vendor search with autofocus and category navigation', async () => {
    await renderResolvedPicker()

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

  it('uses compact dimensions and Cherry theme variables', async () => {
    const { container } = await renderResolvedPicker()

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
      '--epr-category-label-height': '32px',
      '--epr-search-input-bg-color': 'var(--color-background)',
      '--epr-search-input-bg-color-active': 'var(--color-background)',
      '--epr-search-input-height': '32px',
      '--epr-search-input-text-color': 'var(--color-foreground)',
      '--epr-search-input-placeholder-color': 'var(--color-foreground-muted)',
      '--epr-search-border-color': 'var(--color-input)',
      '--epr-search-border-color-active': 'var(--color-ring)',
      '--epr-header-padding': 'var(--epr-horizontal-padding) var(--epr-horizontal-padding) 2px',
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

  it('passes category icons through the public categories configuration', async () => {
    await renderResolvedPicker()

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
    expect(categoryLabelRule).toContain('font-size: var(--font-size-body-sm)')
    expect(categoryLabelRule).not.toContain('font-size: 14px')
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

  it('aligns the picker bottom spacing with its horizontal and search top spacing', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/components/EmojiPicker/EmojiPicker.css'), 'utf-8')
    const categoryNavigationRule = css.match(/\.cherry-emoji-picker-react \.epr-category-nav\s*\{([^}]*)\}/)?.[1]
    const emojiListRule = css.match(/\.cherry-emoji-picker-react \.epr-emoji-list\s*\{([^}]*)\}/)?.[1]

    expect(categoryNavigationRule).toContain('padding-top: 6px')
    expect(emojiListRule).toContain('padding-bottom: var(--epr-horizontal-padding)')
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

  it('uses every bundled native emoji, auto theme, no preview, and no skin tone picker', async () => {
    await renderResolvedPicker()

    expect(emojiPickerPropsMock.value.emojiStyle).toBe('native')
    expect(emojiPickerPropsMock.value.emojiVersion).toBeUndefined()
    expect(emojiPickerPropsMock.value.theme).toBe('auto')
    expect(emojiPickerPropsMock.value.previewConfig).toEqual({ showPreview: false })
    expect(emojiPickerPropsMock.value.skinTonesDisabled).toBe(true)
    expect(screen.queryByTestId('emoji-preview')).not.toBeInTheDocument()
    expect(screen.queryByTestId('skin-tone-picker')).not.toBeInTheDocument()
  })

  it('loads the complete Emoji 17 data set used by v1', async () => {
    await renderResolvedPicker()

    await waitFor(() => {
      const emojis = Object.values(emojiPickerPropsMock.value.emojiData?.emojis ?? {}).flat() as Array<{
        a: string
        n: string[]
        u: string
        v?: string[]
      }>

      expect(emojis).toHaveLength(1914)
      expect(new Set(emojis.map((emoji) => emoji.u)).size).toBe(1914)
      expect(emojis.every((emoji) => emoji.a && emoji.n.length > 0 && emoji.u)).toBe(true)
      expect(emojis.filter((emoji) => Number(emoji.a) > 13)).toHaveLength(109)
      expect(emojis.filter((emoji) => emoji.a === '16')).toHaveLength(8)
      expect(emojis.filter((emoji) => emoji.a === '17')).toHaveLength(8)
      expect(emojis).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ a: '16', u: '1fae9' }),
          expect.objectContaining({ a: '17', u: '1faea' }),
          expect.objectContaining({ a: '16', u: '1f1e8-1f1f6' })
        ])
      )
      expect(emojis.find((emoji) => emoji.u === '1f44b')?.v).toContain('1f44b-1f3fb')
      expect(emojis.some((emoji) => emoji.u === '1f3fb')).toBe(false)
      expect(emojiPickerPropsMock.value.emojiData.emojis.flags).toEqual(
        expect.arrayContaining([expect.objectContaining({ a: '16', u: '1f1e8-1f1f6' })])
      )
    })
  })

  it('loads localized emoji data when the app language changes', async () => {
    i18nLanguageMock.value = 'zh-CN'

    await renderResolvedPicker()

    await waitFor(() => {
      expect(emojiPickerPropsMock.value.emojiData.emojis.smileys_people).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ a: '17', n: expect.arrayContaining(['变形的脸']), u: '1faea' })
        ])
      )
    })
  })

  it('uses Cherry recent emojis as the third-party picker suggested category', async () => {
    const { MockUseCacheUtils } = await import('../../../../../tests/__mocks__/renderer/useCache')
    MockUseCacheUtils.setPersistCacheValue('ui.emoji.recently_used', ['🧠', '📁'])

    await renderResolvedPicker()

    expect(screen.getByTestId('emoji-picker-categories')).toHaveTextContent('emoji_picker.categories.recent')
    expect(emojiPickerPropsMock.value.suggestedEmojis).toEqual(['🧠', '📁'])
    expect(screen.getByRole('button', { name: '🧠' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '📁' })).toBeInTheDocument()
  })

  it('calls onEmojiClick and updates Cherry recent emojis when an emoji is picked', async () => {
    const { MockUseCacheUtils } = await import('../../../../../tests/__mocks__/renderer/useCache')
    MockUseCacheUtils.setPersistCacheValue('ui.emoji.recently_used', ['🧠', '📁'])

    const handleClick = vi.fn()
    await renderResolvedPicker(handleClick)

    fireEvent.click(screen.getByRole('button', { name: 'Pick robot' }))
    expect(handleClick).toHaveBeenCalledWith('🤖')
    expect(MockUseCacheUtils.getPersistCacheValue('ui.emoji.recently_used')).toEqual(['🤖', '🧠', '📁'])
  })
})
