import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EmojiPicker } from '..'
import { resetEmojiSupportLevelCacheForTesting } from '../emojiSupport'

const emojiPickerPropsMock = vi.hoisted((): { value: any } => ({ value: undefined }))
const i18nLanguageMock = vi.hoisted(() => ({ value: 'en-US' }))
const require = createRequire(import.meta.url)
const loadSourceEmojiRecords = (locale: 'en' | 'zh' | 'it') =>
  JSON.parse(readFileSync(require.resolve(`emoji-picker-element-data/${locale}/cldr/data.json`), 'utf-8')) as unknown[]
const sourceEmojiRecords = {
  en: loadSourceEmojiRecords('en'),
  it: loadSourceEmojiRecords('it'),
  zh: loadSourceEmojiRecords('zh')
}
const emojiPickerCss = readFileSync(join(process.cwd(), 'src/renderer/components/EmojiPicker/EmojiPicker.css'), 'utf-8')
const emojiSupportMock = { supportedEmoji: '🫪' }
const emojiWidthMock = { baselineWidth: 16, zwjWidth: 36 }

const stubEmojiSupportLevel = () => {
  const createElement = document.createElement.bind(document)

  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
    const element = createElement(tagName, options)

    if (tagName.toLowerCase() === 'canvas') {
      let renderedText = ''
      const context = {
        fillStyle: '',
        font: '',
        textBaseline: '',
        fillText: vi.fn((text: string) => {
          renderedText = text
        }),
        getImageData: vi.fn(() => ({
          data:
            renderedText === emojiSupportMock.supportedEmoji
              ? new Uint8ClampedArray([1, 2, 3, 255])
              : new Uint8ClampedArray([0, 0, 0, 0])
        })),
        scale: vi.fn()
      } as unknown as CanvasRenderingContext2D

      vi.spyOn(element as HTMLCanvasElement, 'getContext').mockReturnValue(context)
    }

    return element
  }) as typeof document.createElement)
}

const stubZwjEmojiWidthSupport = () => {
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    let selectedText = ''

    return {
      getBoundingClientRect: vi.fn(() => ({
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        toJSON: vi.fn(),
        top: 0,
        width: selectedText.includes('\u200d') ? emojiWidthMock.zwjWidth : emojiWidthMock.baselineWidth,
        x: 0,
        y: 0
      })),
      selectNode: vi.fn((node: Node) => {
        selectedText = node.textContent ?? ''
      })
    } as unknown as Range
  })
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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('EmojiPicker', () => {
  beforeEach(() => {
    i18nLanguageMock.value = 'en-US'
    emojiPickerPropsMock.value = undefined
    emojiSupportMock.supportedEmoji = '🫪'
    emojiWidthMock.baselineWidth = 16
    emojiWidthMock.zwjWidth = 36
    resetEmojiSupportLevelCacheForTesting()
    stubEmojiSupportLevel()
    stubZwjEmojiWidthSupport()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        const records = url.includes('/zh/')
          ? sourceEmojiRecords.zh
          : url.includes('/it/')
            ? sourceEmojiRecords.it
            : sourceEmojiRecords.en
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
    // The picker chunk is lazy; under a loaded worker pool it resolves past the 1s default.
    await screen.findByTestId('emoji-picker-react', undefined, { timeout: 10_000 })
    return view
  }

  it('uses the bundled country flag font for native emojis on Windows', () => {
    const windowsNativeEmojiRule = emojiPickerCss.match(
      /body\[os='windows'\] \.cherry-emoji-picker-react \.epr-emoji-native\s*\{([^}]*)\}/
    )?.[1]

    expect(windowsNativeEmojiRule).toMatch(/font-family:\s*'Twemoji Country Flags'/)
    expect(windowsNativeEmojiRule).toContain('!important')
  })

  it('caps native emoji rendering to the detected platform support level', async () => {
    emojiSupportMock.supportedEmoji = '🫨'

    await renderResolvedPicker()

    await waitFor(() => {
      expect(emojiPickerPropsMock.value.emojiVersion).toBe('15.1')
    })
  })

  it('hides ZWJ emojis that render wider than a single emoji glyph', async () => {
    await renderResolvedPicker()

    await waitFor(() => {
      expect(emojiPickerPropsMock.value.hiddenEmojis).toEqual(
        expect.arrayContaining(['1f636-200d-1f32b-fe0f', '2764-fe0f-200d-1f525'])
      )
    })
    expect(emojiPickerPropsMock.value.hiddenEmojis).not.toContain('1f600')
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

  it('loads the Italian emoji data when the app language is it-IT', async () => {
    i18nLanguageMock.value = 'it-IT'

    await renderResolvedPicker()

    await waitFor(() => {
      expect(emojiPickerPropsMock.value.emojiData.emojis.smileys_people).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ a: '17', n: expect.arrayContaining(['faccina stravolta']), u: '1faea' })
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
