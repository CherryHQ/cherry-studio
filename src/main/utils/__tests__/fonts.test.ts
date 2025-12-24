import { describe, expect, it } from 'vitest'

import { parseMacAtsutilFontFamilies } from '../fonts'

describe('parseMacAtsutilFontFamilies', () => {
  it('在没有 System Families 段落时返回空数组', () => {
    expect(parseMacAtsutilFontFamilies('System Fonts:\n\tMenlo-Regular\n')).toEqual([])
  })

  it('能解析并去重排序 System Families', () => {
    const output = [
      'System Fonts:',
      '\tMenlo-Regular',
      'System Families:',
      '\tPingFang SC',
      '\tSongti SC',
      '\tPingFang SC',
      '\tSTHeiti',
      ''
    ].join('\n')

    expect(parseMacAtsutilFontFamilies(output)).toEqual(['PingFang SC', 'Songti SC', 'STHeiti'])
  })
})
