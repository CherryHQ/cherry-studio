import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it } from 'vitest'

import { replacePromptVariables } from '../prompt'

describe('replacePromptVariables (main)', () => {
  beforeEach(() => MockMainPreferenceServiceUtils.resetMocks())

  it('renders {{system}} as the device type the renderer preview shows', async () => {
    expect(await replacePromptVariables('{{system}}')).toMatch(/^(mac|windows|linux)$/)
  })

  it('renders {{language}} from the system locale when the user has not picked one', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.language', null)
    expect(await replacePromptVariables('{{language}}')).not.toBe('Unknown System Language')
  })
})
