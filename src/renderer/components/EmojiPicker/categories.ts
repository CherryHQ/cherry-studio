export interface EmojiCategory {
  group: number
  labelKey: string
}

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  { group: 0, labelKey: 'emoji_picker.categories.smileys_emotion' },
  { group: 1, labelKey: 'emoji_picker.categories.people_body' },
  { group: 2, labelKey: 'emoji_picker.categories.animals_nature' },
  { group: 3, labelKey: 'emoji_picker.categories.food_drink' },
  { group: 4, labelKey: 'emoji_picker.categories.travel_places' },
  { group: 5, labelKey: 'emoji_picker.categories.activities' },
  { group: 6, labelKey: 'emoji_picker.categories.objects' },
  { group: 7, labelKey: 'emoji_picker.categories.symbols' },
  { group: 8, labelKey: 'emoji_picker.categories.flags' }
] as const

export const RECENT_CATEGORY_LABEL_KEY = 'emoji_picker.categories.recent'
