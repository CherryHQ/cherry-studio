import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ edition: 'cn' as 'cn' | 'global' }))

vi.mock('@renderer/pages/settings/ProfileSettings', () => ({ ProfileSettings: () => null }))
vi.mock('@renderer/utils/appEdition', () => ({ getAppEdition: () => mocks.edition }))

import { Route } from '../profile'

const beforeLoad = Route.options.beforeLoad as () => void

describe('personal information route', () => {
  it('redirects an old CN profile link to regular settings', () => {
    mocks.edition = 'cn'

    let result: unknown
    try {
      beforeLoad()
    } catch (error) {
      result = error
    }

    expect(isRedirect(result)).toBe(true)
    expect(result).toMatchObject({ options: { to: '/settings/provider' } })
  })

  it('keeps the global profile page available', () => {
    mocks.edition = 'global'

    expect(beforeLoad()).toBeUndefined()
  })
})
