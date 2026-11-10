import { expect, it } from 'vitest'

import { FILE_PROCESSOR_IDS } from '@shared/data/preference/preferenceTypes'

import { getFileProcessorLabelKey } from '../label'
import en from '../locales/en-us.json'

it('resolves every file processor to an English label', () => {
  for (const id of FILE_PROCESSOR_IDS) {
    const key = getFileProcessorLabelKey(id)
    expect(key).not.toBe(id)
    expect(en).toHaveProperty(key)
  }
})
