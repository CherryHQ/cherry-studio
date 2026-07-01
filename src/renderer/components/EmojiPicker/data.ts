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

export interface EmojiRecord {
  emoji: string
  annotation: string
  tags?: string[]
  shortcodes?: string[]
  group: number
  order: number
}

const DATA_URL_MAP: Record<LanguageVarious, string> = {
  'ar-YE': dataEN,
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

const dataCache = new Map<string, Promise<EmojiRecord[]>>()

export const loadEmojiData = (locale: LanguageVarious): Promise<EmojiRecord[]> => {
  const url = DATA_URL_MAP[locale] ?? dataEN
  const cached = dataCache.get(url)
  if (cached) return cached

  const promise = fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load emoji data from ${url}: ${response.status} ${response.statusText}`)
      }

      return response.json() as Promise<EmojiRecord[]>
    })
    .then((records) => records.filter((record) => record.group < 9))
    .catch((error) => {
      dataCache.delete(url)
      throw error
    })

  dataCache.set(url, promise)
  return promise
}
