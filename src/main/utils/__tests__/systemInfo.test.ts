import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { validate as isUuid } from 'uuid'
import { beforeEach, describe, expect, it } from 'vitest'

import { getClientId } from '../systemInfo'

describe('getClientId', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
  })

  it('generates and persists a client ID for a new user', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.user.id', '')

    const clientId = getClientId()

    expect(isUuid(clientId)).toBe(true)
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('app.user.id')).toBe(clientId)
  })

  it.each(['uuid()', 'not-a-uuid'])('replaces an invalid stored client ID: %s', (storedClientId) => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.user.id', storedClientId)

    const clientId = getClientId()

    expect(isUuid(clientId)).toBe(true)
    expect(clientId).not.toBe(storedClientId)
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('app.user.id')).toBe(clientId)
  })

  it('preserves a valid stored client ID', () => {
    const storedClientId = '91f06c3a-1776-4e98-a76f-18e03e1e6f96'
    MockMainPreferenceServiceUtils.setPreferenceValue('app.user.id', storedClientId)

    expect(getClientId()).toBe(storedClientId)
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('app.user.id')).toBe(storedClientId)
  })
})
