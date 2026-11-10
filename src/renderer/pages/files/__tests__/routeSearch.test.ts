import { describe, expect, it } from 'vitest'

import { parseFilesRouteSearch } from '../routeSearch'

describe('parseFilesRouteSearch', () => {
  it('keeps a non-empty entry id', () => {
    expect(parseFilesRouteSearch({ entryId: 'entry-1' })).toEqual({ entryId: 'entry-1' })
  })

  it('drops empty and non-string values', () => {
    expect(parseFilesRouteSearch({ entryId: '' })).toEqual({ entryId: undefined })
    expect(parseFilesRouteSearch({ entryId: 1 })).toEqual({ entryId: undefined })
  })
})
