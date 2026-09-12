import { expect, it } from 'vitest'

import { transcriptParagraphs } from './transcript'

it('preserves text and does not invent speaker labels or timestamps', () => {
  expect(transcriptParagraphs('会议日期：9月8日\r\n\r\n张晨：下周交付。\n保留第二行。')).toEqual([
    { text: '会议日期：9月8日' },
    { text: '张晨：下周交付。\n保留第二行。' }
  ])
})
it('uses timestamps actually present in SRT cues', () => {
  expect(
    transcriptParagraphs('1\n00:01:02,300 --> 00:01:05,000\n第一句\n\n2\n00:01:06,100 --> 00:01:08,000\n第二句')
  ).toEqual([
    { timestamp: '00:01:02.300', text: '第一句' },
    { timestamp: '00:01:06.100', text: '第二句' }
  ])
})
