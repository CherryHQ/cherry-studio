import { describe, expect, it } from 'vitest'

import { collectMainTranslationKeys } from '../i18n-main-keys'

describe('main translation key coverage', () => {
  it('ignores regexes, comments and quoted examples while retaining real keys', () => {
    const source = `import { t } from '@main/i18n'
      const regex = /[ci]t(?:e)?/
      const example = "t(variable)"
      // t(dynamic)
      t('common.channel_stopped')`
    expect(collectMainTranslationKeys(source, 'listener.ts')).toEqual({ keys: ['common.channel_stopped'], dynamic: [] })
  })

  it('reports dynamic calls and follows the imported translator alias', () => {
    const source = `import { t as translate } from '@main/i18n'
      translate('common.known')
      translate(variable)`
    expect(collectMainTranslationKeys(source, 'alias.ts')).toEqual({
      keys: ['common.known'],
      dynamic: ['translate(variable)']
    })
  })

  it('does not treat another module or an object method as the main translator', () => {
    expect(collectMainTranslationKeys("import { t } from 'other'; t(variable)", 'other.ts')).toEqual({
      keys: [],
      dynamic: []
    })
    expect(collectMainTranslationKeys("import { t } from '@main/i18n'; object.t(variable)", 'object.ts')).toEqual({
      keys: [],
      dynamic: []
    })
  })
})
