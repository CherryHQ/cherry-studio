import { Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import { defaultLanguage } from '@shared/utils/languages'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EMOJI_CATEGORIES, RECENT_CATEGORY_LABEL_KEY } from './categories'
import { type EmojiRecord, loadEmojiData } from './data'
import { useRecentEmojis } from './useRecentEmojis'

const logger = loggerService.withContext('EmojiPicker')

interface Props {
  onEmojiClick: (emoji: string) => void
}

const EmojiPicker: FC<Props> = ({ onEmojiClick }) => {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LanguageVarious
  const [emojis, setEmojis] = useState<EmojiRecord[]>([])
  const { recent, pushRecent } = useRecentEmojis()

  useEffect(() => {
    let cancelled = false
    void loadEmojiData(locale)
      .catch((error) => {
        logger.error('Failed to load emoji data', error)
        if (locale === defaultLanguage) {
          return []
        }

        return loadEmojiData(defaultLanguage as LanguageVarious)
      })
      .catch((error) => {
        logger.error('Failed to load fallback emoji data', error)
        return []
      })
      .then((records) => {
        if (!cancelled) setEmojis(records)
      })
    return () => {
      cancelled = true
    }
  }, [locale])

  const groupedEmojis = useMemo(() => {
    const groups = new Map<number, EmojiRecord[]>()
    for (const record of emojis) {
      const list = groups.get(record.group) ?? []
      list.push(record)
      groups.set(record.group, list)
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.order - b.order)
    }
    return groups
  }, [emojis])

  const handleEmojiPick = (emoji: string) => {
    pushRecent(emoji)
    onEmojiClick(emoji)
  }

  const showRecentSection = recent.length > 0

  return (
    <div className="flex h-88 max-h-[min(22rem,calc(100vh-6rem))] w-72 max-w-[calc(100vw-2rem)] flex-col rounded-lg bg-card text-card-foreground">
      <Scrollbar className="min-h-0 flex-1 overscroll-contain px-2.5 pb-2">
        {showRecentSection ? (
          <EmojiSection
            title={t(RECENT_CATEGORY_LABEL_KEY)}
            emojis={recent.map((emoji) => ({ emoji }))}
            onPick={handleEmojiPick}
          />
        ) : null}
        {EMOJI_CATEGORIES.map(({ group, labelKey }) => {
          const records = groupedEmojis.get(group)
          if (!records || records.length === 0) return null
          return <EmojiSection key={group} title={t(labelKey)} emojis={records} onPick={handleEmojiPick} />
        })}
      </Scrollbar>
    </div>
  )
}

interface EmojiSectionProps {
  title: string
  emojis: Array<Pick<EmojiRecord, 'emoji'> & Partial<EmojiRecord>>
  onPick: (emoji: string) => void
}

const EmojiSection: FC<EmojiSectionProps> = ({ title, emojis, onPick }) => {
  return (
    <div className="pt-1.5 first:pt-0">
      <h3 className="sticky top-0 z-10 bg-card py-1.5 font-semibold text-foreground text-xs">{title}</h3>
      <EmojiGrid emojis={emojis} onPick={onPick} />
    </div>
  )
}

interface EmojiGridProps {
  emojis: Array<Pick<EmojiRecord, 'emoji'> & Partial<EmojiRecord>>
  onPick: (emoji: string) => void
}

const EmojiGrid: FC<EmojiGridProps> = ({ emojis, onPick }) => {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {emojis.map((record) => (
        <button
          key={record.emoji}
          type="button"
          aria-label={record.annotation ?? record.emoji}
          onClick={() => onPick(record.emoji)}
          className={cn(
            'flex aspect-square items-center justify-center rounded-md text-base leading-none',
            'transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none'
          )}>
          {record.emoji}
        </button>
      ))}
    </div>
  )
}

export default EmojiPicker
