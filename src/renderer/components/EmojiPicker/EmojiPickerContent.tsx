import './EmojiPicker.css'

import { loggerService } from '@logger'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import EmojiPickerReact, {
  Categories,
  type EmojiClickData,
  EmojiStyle,
  SuggestionMode,
  Theme
} from 'emoji-picker-react'
import { Clock3, Flag, Hash, Lightbulb, PawPrint, Plane, Smile, Trophy, Utensils } from 'lucide-react'
import type { CSSProperties, FC, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type EmojiData, loadEmojiData } from './emojiData'
import type { EmojiPickerProps } from './EmojiPicker'
import { useRecentEmojis } from './useRecentEmojis'

const logger = loggerService.withContext('EmojiPicker')

const CHERRY_PICKER_STYLE = {
  '--epr-bg-color': 'var(--color-popover)',
  '--epr-picker-border-color': 'transparent',
  '--epr-picker-border-radius': 'var(--radius-lg)',
  '--epr-highlight-color': 'var(--color-primary)',
  '--epr-hover-bg-color': 'var(--color-accent)',
  '--epr-hover-bg-color-reduced-opacity': 'var(--color-accent)',
  '--epr-focus-bg-color': 'var(--color-accent)',
  '--epr-text-color': 'var(--color-popover-foreground)',
  '--epr-category-label-bg-color': 'var(--color-popover)',
  '--epr-category-label-text-color': 'var(--color-popover-foreground)',
  '--epr-category-label-height': '32px',
  '--epr-category-icon-active-color': 'var(--color-primary)',
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
} as CSSProperties

const CATEGORY_ORDER = [
  Categories.SUGGESTED,
  Categories.SMILEYS_PEOPLE,
  Categories.ANIMALS_NATURE,
  Categories.FOOD_DRINK,
  Categories.TRAVEL_PLACES,
  Categories.ACTIVITIES,
  Categories.OBJECTS,
  Categories.SYMBOLS,
  Categories.FLAGS
] as const

const CATEGORY_LABEL_KEYS: Record<(typeof CATEGORY_ORDER)[number], string> = {
  [Categories.SUGGESTED]: 'emoji_picker.categories.recent',
  [Categories.SMILEYS_PEOPLE]: 'emoji_picker.categories.smileys_emotion',
  [Categories.ANIMALS_NATURE]: 'emoji_picker.categories.animals_nature',
  [Categories.FOOD_DRINK]: 'emoji_picker.categories.food_drink',
  [Categories.TRAVEL_PLACES]: 'emoji_picker.categories.travel_places',
  [Categories.ACTIVITIES]: 'emoji_picker.categories.activities',
  [Categories.OBJECTS]: 'emoji_picker.categories.objects',
  [Categories.SYMBOLS]: 'emoji_picker.categories.symbols',
  [Categories.FLAGS]: 'emoji_picker.categories.flags'
}

const CATEGORY_ICON_CLASS = 'size-4.5'

const CATEGORY_ICONS: Record<(typeof CATEGORY_ORDER)[number], ReactNode> = {
  [Categories.SUGGESTED]: <Clock3 className={CATEGORY_ICON_CLASS} />,
  [Categories.SMILEYS_PEOPLE]: <Smile className={CATEGORY_ICON_CLASS} />,
  [Categories.ANIMALS_NATURE]: <PawPrint className={CATEGORY_ICON_CLASS} />,
  [Categories.FOOD_DRINK]: <Utensils className={CATEGORY_ICON_CLASS} />,
  [Categories.TRAVEL_PLACES]: <Plane className={CATEGORY_ICON_CLASS} />,
  [Categories.ACTIVITIES]: <Trophy className={CATEGORY_ICON_CLASS} />,
  [Categories.OBJECTS]: <Lightbulb className={CATEGORY_ICON_CLASS} />,
  [Categories.SYMBOLS]: <Hash className={CATEGORY_ICON_CLASS} />,
  [Categories.FLAGS]: <Flag className={CATEGORY_ICON_CLASS} />
}

const EmojiPickerContent: FC<EmojiPickerProps> = ({ onEmojiClick }) => {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LanguageVarious
  const [emojiData, setEmojiData] = useState<EmojiData | undefined>()
  const { recent, pushRecent } = useRecentEmojis()

  useEffect(() => {
    let cancelled = false

    setEmojiData(undefined)
    void loadEmojiData(locale)
      .then((data) => {
        if (!cancelled) setEmojiData(data)
      })
      .catch((error) => {
        logger.error('Failed to load localized emoji data', error)
        if (!cancelled) setEmojiData(undefined)
      })

    return () => {
      cancelled = true
    }
  }, [locale])

  const categories = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        name: t(CATEGORY_LABEL_KEYS[category]),
        icon: CATEGORY_ICONS[category]
      })),
    [t]
  )

  const handleEmojiClick = (emoji: EmojiClickData) => {
    pushRecent(emoji.emoji)
    onEmojiClick(emoji.emoji)
  }

  return (
    <div className="h-88 max-h-[min(22rem,calc(100vh-6rem))] w-80 max-w-[calc(100vw-2rem)] rounded-lg bg-popover text-popover-foreground">
      <EmojiPickerReact
        autoFocusSearch
        categories={categories}
        className="cherry-emoji-picker-react"
        emojiData={emojiData}
        emojiStyle={EmojiStyle.NATIVE}
        height="100%"
        previewConfig={{ showPreview: false }}
        searchClearButtonLabel={t('common.clear')}
        searchDisabled={false}
        searchPlaceholder={t('emoji_picker.search')}
        skinTonesDisabled
        style={CHERRY_PICKER_STYLE}
        suggestedEmojis={recent}
        suggestedEmojisMode={SuggestionMode.RECENT}
        theme={Theme.AUTO}
        width="100%"
        onEmojiClick={handleEmojiClick}
      />
    </div>
  )
}

export default EmojiPickerContent
