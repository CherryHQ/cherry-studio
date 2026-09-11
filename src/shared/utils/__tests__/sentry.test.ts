import { describe, expect, it } from 'vitest'

import { getSentryBuildContext, getSentryLogError } from '../sentry'

describe('Sentry context', () => {
  it.each([
    ['2.0.14', 'stable'],
    ['2.1.0-rc.2', 'rc'],
    ['2.1.0-beta.3', 'beta'],
    ['2.1.0-nightly.20260911', 'nightly']
  ])('labels build %s with channel %s', (version, channel) => {
    expect(getSentryBuildContext('CherryStudio', version, 'cn')).toEqual({
      release: `CherryStudio@${version}`,
      tags: { 'app.version': version, 'app.channel': channel, 'app.edition': 'cn' }
    })
  })

  it('keeps only explicit operation identifiers and excludes business data', () => {
    const info = {
      level: 'error',
      name: 'Error',
      errorMessage: 'Failed',
      stack: 'Error: Failed\n at run (app:///job.js:2:3)',
      operation: 'job.schedule.fire',
      module: 'JobManager',
      code: 'SQLITE_BUSY',
      process: 'main',
      scheduleId: 'private-id',
      context: { prompt: 'private conversation' }
    }
    expect(getSentryLogError(info)?.context).toEqual({
      tags: { module: 'JobManager', code: 'SQLITE_BUSY', operation: 'job.schedule.fire', 'event.process': 'main' },
      extra: undefined
    })
    expect(getSentryLogError({ ...info, operation: 'user typed this text' })?.context.tags).not.toHaveProperty(
      'operation'
    )
  })
})
