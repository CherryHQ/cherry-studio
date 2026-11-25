import koreanRecords from 'emoji-picker-element-data/ko/cldr/data.json'
import { afterEach, expect, it, vi } from 'vitest'

import { loadEmojiData } from '../emojiData'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('makes emojis searchable by Korean names and keywords when Korean is selected', async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    if (!url.includes('/ko/cldr/data.json')) return new Response(null, { status: 404 })
    return Response.json(koreanRecords)
  })

  const data = await loadEmojiData('ko-KR')
  const smile = data.emojis.smileys_people.find((emoji) => emoji.u === '1f600')

  expect(smile?.n).toEqual(expect.arrayContaining(['활짝 웃는 얼굴', '미소', '웃음']))
})
