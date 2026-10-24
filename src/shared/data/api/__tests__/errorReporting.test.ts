import { describe, expect, it } from 'vitest'

import { hasReportingOwner, markReportingHandled } from '../../../utils/errorReporting'
import { DataApiError, toDataApiError } from '../errors'

describe('DataApi reporting ownership', () => {
  it.each([DataApiError.fromError, toDataApiError])(
    'preserves ownership through wrapping and IPC without adding it to unowned failures',
    (wrap) => {
      const error = new Error('storage failure')
      expect(hasReportingOwner(DataApiError.fromJSON(wrap(error).toJSON()))).toBe(false)
      markReportingHandled(error)
      expect(hasReportingOwner(DataApiError.fromJSON(wrap(error).toJSON()))).toBe(true)
    }
  )
})
