import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import dataDE from 'emoji-picker-element-data/de/cldr/data.json?url'
import dataEN from 'emoji-picker-element-data/en/cldr/data.json?url'
import dataES from 'emoji-picker-element-data/es/cldr/data.json?url'
import dataFR from 'emoji-picker-element-data/fr/cldr/data.json?url'
import dataJA from 'emoji-picker-element-data/ja/cldr/data.json?url'
import dataPT from 'emoji-picker-element-data/pt/cldr/data.json?url'
import dataRU from 'emoji-picker-element-data/ru/cldr/data.json?url'
import dataZH from 'emoji-picker-element-data/zh/cldr/data.json?url'
import dataZH_HANT from 'emoji-picker-element-data/zh-hant/cldr/data.json?url'
import { Categories, type Props as EmojiPickerReactProps } from 'emoji-picker-react'

export type EmojiData = NonNullable<EmojiPickerReactProps['emojiData']>

interface EmojiSkinRecord {
  emoji: string
}

export interface EmojiRecord {
  annotation: string
  emoji: string
  group: number
  order: number
  shortcodes?: string[]
  skins?: EmojiSkinRecord[]
  tags?: string[]
  version: number
}

const DATA_URL_MAP: Record<LanguageVarious, string> = {
  'en-US': dataEN,
  'zh-CN': dataZH,
  'zh-TW': dataZH_HANT,
  'de-DE': dataDE,
  'el-GR': dataEN,
  'es-ES': dataES,
  'fr-FR': dataFR,
  'ja-JP': dataJA,
  'pt-PT': dataPT,
  'ro-RO': dataEN,
  'ru-RU': dataRU,
  'vi-VN': dataEN
}

const GROUP_TO_CATEGORY: Partial<Record<number, Categories>> = {
  0: Categories.SMILEYS_PEOPLE,
  1: Categories.SMILEYS_PEOPLE,
  3: Categories.ANIMALS_NATURE,
  4: Categories.FOOD_DRINK,
  5: Categories.TRAVEL_PLACES,
  6: Categories.ACTIVITIES,
  7: Categories.OBJECTS,
  8: Categories.SYMBOLS,
  9: Categories.FLAGS
}

const dataCache = new Map<string, Promise<EmojiData>>()

const nativeEmojiToUnified = (emoji: string): string =>
  Array.from(emoji)
    .map((codePoint) => codePoint.codePointAt(0)?.toString(16).padStart(4, '0'))
    .filter(Boolean)
    .join('-')

const getEmojiNames = (record: EmojiRecord): string[] => {
  const names = [
    ...(record.shortcodes ?? []).map((shortcode) => shortcode.replaceAll(/[_-]+/g, ' ')),
    ...(record.tags ?? []),
    record.annotation
  ]

  return [...new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean))]
}

export const convertEmojiRecords = (records: EmojiRecord[]): EmojiData => {
  const emojis: EmojiData['emojis'] = {
    [Categories.CUSTOM]: [],
    [Categories.SMILEYS_PEOPLE]: [],
    [Categories.ANIMALS_NATURE]: [],
    [Categories.FOOD_DRINK]: [],
    [Categories.TRAVEL_PLACES]: [],
    [Categories.ACTIVITIES]: [],
    [Categories.OBJECTS]: [],
    [Categories.SYMBOLS]: [],
    [Categories.FLAGS]: []
  }

  for (const record of [...records].sort((left, right) => left.order - right.order)) {
    const category = GROUP_TO_CATEGORY[record.group]
    if (!category) continue

    const variations = record.skins?.map((skin) => nativeEmojiToUnified(skin.emoji))
    emojis[category].push({
      n: getEmojiNames(record),
      u: nativeEmojiToUnified(record.emoji),
      a: String(record.version),
      ...(variations?.length ? { v: variations } : {})
    })
  }

  return { categories: {}, emojis }
}

const loadEmojiDataUrl = (url: string): Promise<EmojiData> => {
  const cached = dataCache.get(url)
  if (cached) return cached

  const promise = fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load emoji data from ${url}: ${response.status} ${response.statusText}`)
      }

      return response.json() as Promise<EmojiRecord[]>
    })
    .then(convertEmojiRecords)
    .catch((error) => {
      dataCache.delete(url)
      throw error
    })

  dataCache.set(url, promise)
  return promise
}

export const loadEmojiData = async (locale: LanguageVarious): Promise<EmojiData> => {
  const url = DATA_URL_MAP[locale]

  try {
    return await loadEmojiDataUrl(url)
  } catch (error) {
    if (url === dataEN) throw error
    return loadEmojiDataUrl(dataEN)
  }
}
