import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import EmojiPickerReact, { Categories, EmojiStyle, SuggestionMode } from 'emoji-picker-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { convertEmojiRecords } from '../emojiData'

vi.stubGlobal(
  'IntersectionObserver',
  class IntersectionObserver {
    constructor(private readonly callback: IntersectionObserverCallback) {}

    observe(target: Element) {
      this.callback(
        [
          {
            intersectionRatio: 1,
            isIntersecting: true,
            target
          } as IntersectionObserverEntry
        ],
        this as unknown as globalThis.IntersectionObserver
      )
    }

    disconnect() {}
    unobserve() {}
    takeRecords() {
      return []
    }
  }
)

describe('emoji-picker-react controlled suggestions patch', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders the controlled native emoji list instead of vendor local storage', async () => {
    localStorage.setItem('epr_suggested', JSON.stringify([{ unified: '1f916', original: '1f916', count: 1 }]))

    render(
      <EmojiPickerReact
        categories={[{ category: Categories.SUGGESTED, name: 'Recently Used' }]}
        emojiStyle={EmojiStyle.NATIVE}
        previewConfig={{ showPreview: false }}
        searchDisabled
        skinTonesDisabled
        suggestedEmojis={['🧠', '📁']}
        suggestedEmojisMode={SuggestionMode.RECENT}
      />
    )

    const suggestedCategory = await screen.findByRole('listitem', { name: 'Recently Used' })

    expect(within(suggestedCategory).getByText('🧠')).toBeInTheDocument()
    expect(within(suggestedCategory).getByText('📁')).toBeInTheDocument()
    expect(within(suggestedCategory).queryByText('🤖')).not.toBeInTheDocument()
  })

  it('uses zero-padded vendor unified IDs for BMP and keycap emojis', async () => {
    render(
      <EmojiPickerReact
        categories={[{ category: Categories.SUGGESTED, name: 'Recently Used' }]}
        emojiStyle={EmojiStyle.NATIVE}
        previewConfig={{ showPreview: false }}
        searchDisabled
        skinTonesDisabled
        suggestedEmojis={['©️', '#️⃣']}
        suggestedEmojisMode={SuggestionMode.RECENT}
      />
    )

    const suggestedCategory = await screen.findByRole('listitem', { name: 'Recently Used' })

    expect(within(suggestedCategory).getByText('©️')).toHaveAttribute('data-unified', '00a9-fe0f')
    expect(within(suggestedCategory).getByText('#️⃣')).toHaveAttribute('data-unified', '0023-fe0f-20e3')
  })

  it('updates the controlled list when Cherry recent emojis change', async () => {
    const picker = (suggestedEmojis: string[]) => (
      <EmojiPickerReact
        categories={[{ category: Categories.SUGGESTED, name: 'Recently Used' }]}
        emojiStyle={EmojiStyle.NATIVE}
        previewConfig={{ showPreview: false }}
        searchDisabled
        skinTonesDisabled
        suggestedEmojis={suggestedEmojis}
        suggestedEmojisMode={SuggestionMode.RECENT}
      />
    )
    const view = render(picker(['🧠']))
    const suggestedCategory = await screen.findByRole('listitem', { name: 'Recently Used' })

    expect(within(suggestedCategory).getByText('🧠')).toBeInTheDocument()

    view.rerender(picker(['📁', '🧠']))

    await waitFor(() => {
      expect(within(suggestedCategory).getByText('📁')).toBeInTheDocument()
    })
  })

  it('does not write vendor local storage when controlled suggestions are selected', async () => {
    const onEmojiClick = vi.fn()

    render(
      <EmojiPickerReact
        categories={[{ category: Categories.SUGGESTED, name: 'Recently Used' }]}
        emojiStyle={EmojiStyle.NATIVE}
        previewConfig={{ showPreview: false }}
        searchDisabled
        skinTonesDisabled
        suggestedEmojis={['🧠']}
        suggestedEmojisMode={SuggestionMode.RECENT}
        onEmojiClick={onEmojiClick}
      />
    )

    const suggestedCategory = await screen.findByRole('listitem', { name: 'Recently Used' })
    fireEvent.click(within(suggestedCategory).getByText('🧠').closest('button')!)

    expect(onEmojiClick).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('epr_suggested')).toBeNull()
  })

  it('renders bundled emojis added after Emoji 13 when no version cap is set', async () => {
    render(
      <EmojiPickerReact
        categories={[{ category: Categories.SUGGESTED, name: 'Recently Used' }]}
        emojiStyle={EmojiStyle.NATIVE}
        previewConfig={{ showPreview: false }}
        searchDisabled
        skinTonesDisabled
        suggestedEmojis={['🐦‍🔥']}
        suggestedEmojisMode={SuggestionMode.RECENT}
      />
    )

    const suggestedCategory = await screen.findByRole('listitem', { name: 'Recently Used' })
    expect(within(suggestedCategory).getByText('🐦‍🔥')).toHaveAttribute('data-unified', '1f426-200d-1f525')
  })

  it('renders Emoji 17 supplied by the v1 data adapter', async () => {
    const emojiData = convertEmojiRecords([
      {
        annotation: 'distorted face',
        emoji: '🫪',
        group: 0,
        order: 1,
        tags: ['anxiety', 'surprised'],
        version: 17
      }
    ])

    render(
      <EmojiPickerReact
        categories={[{ category: Categories.SUGGESTED, name: 'Recently Used' }]}
        emojiData={emojiData}
        emojiStyle={EmojiStyle.NATIVE}
        previewConfig={{ showPreview: false }}
        searchDisabled
        skinTonesDisabled
        suggestedEmojis={['🫪']}
        suggestedEmojisMode={SuggestionMode.RECENT}
      />
    )

    const suggestedCategory = await screen.findByRole('listitem', { name: 'Recently Used' })
    expect(within(suggestedCategory).getByText('🫪')).toHaveAttribute('data-unified', '1faea')
  })
})
