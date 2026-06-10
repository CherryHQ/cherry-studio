import { describe, expect, it } from 'vitest'

import { defaultMessageMenuConfig, defaultMessageMenuExportOptions, defaultMessageRenderConfig } from '../types'

describe('message provider defaults', () => {
  it('keeps all message export menu options disabled by default', () => {
    expect(defaultMessageMenuConfig).toEqual({
      confirmDeleteMessage: false,
      enableDeveloperMode: false,
      exportMenuOptions: defaultMessageMenuExportOptions
    })
    expect(Object.values(defaultMessageMenuExportOptions).every((enabled) => enabled === false)).toBe(true)
  })

  it('keeps rendering defaults aligned with standalone message content', () => {
    expect(defaultMessageRenderConfig).toEqual({
      userName: '',
      narrowMode: false,
      messageStyle: 'bubble',
      messageFont: 'system',
      fontSize: 14,
      renderInputMessageAsMarkdown: false,
      codeFancyBlock: true,
      thoughtAutoCollapse: true,
      collapseCompletedToolHistory: true,
      mathEnableSingleDollar: false,
      showMessageOutline: false,
      multiModelMessageStyle: 'horizontal',
      multiModelGridColumns: 2,
      multiModelGridPopoverTrigger: 'click'
    })
  })
})
