import './EmojiPicker.css'

import { loggerService } from '@logger'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import EmojiPickerReact, {
  Categories,
  type EmojiClickData,
  EmojiStyle,
  type Props as EmojiPickerReactProps,
  SuggestionMode,
  Theme
} from 'emoji-picker-react'
import { Clock3, Flag, Hash, Lightbulb, PawPrint, Plane, Smile, Trophy, Utensils } from 'lucide-react'
import type { CSSProperties, FC, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useRecentEmojis } from './useRecentEmojis'

const logger = loggerService.withContext('EmojiPicker')

const CHERRY_PICKER_STYLE = {
  '--epr-bg-color': 'var(--color-card)',
  '--epr-picker-border-color': 'transparent',
  '--epr-picker-border-radius': 'var(--radius-lg)',
  '--epr-highlight-color': 'var(--color-primary)',
  '--epr-hover-bg-color': 'var(--color-accent)',
  '--epr-hover-bg-color-reduced-opacity': 'var(--color-accent)',
  '--epr-focus-bg-color': 'var(--color-accent)',
  '--epr-text-color': 'var(--color-card-foreground)',
  '--epr-category-label-bg-color': 'var(--color-card)',
  '--epr-category-label-text-color': 'var(--color-card-foreground)',
  '--epr-category-icon-active-color': 'var(--color-primary)',
  '--epr-emoji-hover-color': 'var(--color-accent)',
  '--epr-emoji-variation-indicator-color': 'var(--color-border)',
  '--epr-emoji-variation-indicator-color-hover': 'var(--color-foreground)'
} as CSSProperties

type EmojiData = EmojiPickerReactProps['emojiData']
type LocalizedEmojiData = NonNullable<EmojiData>
type EmojiDataLoader = () => Promise<{ default: LocalizedEmojiData }>

const EMOJI_DATA_LOADERS: Partial<Record<LanguageVarious, EmojiDataLoader>> = {
  'zh-CN': () => import('emoji-picker-react/dist/data/emojis-zh'),
  'zh-TW': () => import('emoji-picker-react/dist/data/emojis-zh-hant'),
  'de-DE': () => import('emoji-picker-react/dist/data/emojis-de'),
  'es-ES': () => import('emoji-picker-react/dist/data/emojis-es'),
  'fr-FR': () => import('emoji-picker-react/dist/data/emojis-fr'),
  'ja-JP': () => import('emoji-picker-react/dist/data/emojis-ja'),
  'pt-PT': () => import('emoji-picker-react/dist/data/emojis-pt'),
  'ru-RU': () => import('emoji-picker-react/dist/data/emojis-ru')
}

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

interface Props {
  onEmojiClick: (emoji: string) => void
}

const EmojiPicker: FC<Props> = ({ onEmojiClick }) => {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LanguageVarious
  const [emojiData, setEmojiData] = useState<EmojiData | undefined>()
  const { pushRecent } = useRecentEmojis()

  useEffect(() => {
    let cancelled = false
    const loadEmojiData = EMOJI_DATA_LOADERS[locale]

    setEmojiData(undefined)
    if (!loadEmojiData) return

    void loadEmojiData()
      .then((module) => {
        if (!cancelled) setEmojiData(module.default)
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

  const handleEmojiPick = (emoji: string) => {
    pushRecent(emoji)
    onEmojiClick(emoji)
  }

  const handleEmojiClick = (emoji: EmojiClickData) => {
    handleEmojiPick(emoji.emoji)
  }

  return (
    <div className="h-88 max-h-[min(22rem,calc(100vh-6rem))] w-80 max-w-[calc(100vw-2rem)] rounded-lg bg-card text-card-foreground">
      <EmojiPickerReact
        categories={categories}
        className="cherry-emoji-picker-react"
        emojiData={emojiData}
        emojiStyle={EmojiStyle.NATIVE}
        emojiVersion="13.0"
        height="100%"
        previewConfig={{ showPreview: false }}
        searchDisabled
        skinTonesDisabled
        style={CHERRY_PICKER_STYLE}
        suggestedEmojisMode={SuggestionMode.RECENT}
        theme={Theme.AUTO}
        width="100%"
        onEmojiClick={handleEmojiClick}
      />
    </div>
  )
}

export default EmojiPicker
