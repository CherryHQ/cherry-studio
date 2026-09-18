import { describe, expect, it } from 'vitest'

import { selectAsrRoute } from './routePolicy'

describe('selectAsrRoute', () => {
  it('selects Apple only on macOS 26+ with installed assets', () => {
    expect(selectAsrRoute({ macOSMajor: 26, appleAssetStatus: 'installed', funAsrInstalled: false })).toEqual({
      kind: 'apple'
    })
  })

  it('requires an explicit Apple asset install instead of falling back', () => {
    expect(selectAsrRoute({ macOSMajor: 26, appleAssetStatus: 'supported', funAsrInstalled: true })).toEqual({
      kind: 'blocked',
      code: 'asset_required'
    })
  })

  it('reports an unsupported Apple locale without falling back', () => {
    expect(selectAsrRoute({ macOSMajor: 26, appleAssetStatus: 'unsupported', funAsrInstalled: true })).toEqual({
      kind: 'blocked',
      code: 'unsupported_locale'
    })
  })

  it('uses installed FunASR before macOS 26', () => {
    expect(selectAsrRoute({ macOSMajor: 25, appleAssetStatus: 'unsupported', funAsrInstalled: true })).toEqual({
      kind: 'fun-asr'
    })
  })

  it('requires an explicit FunASR model install before macOS 26', () => {
    expect(selectAsrRoute({ macOSMajor: 25, appleAssetStatus: 'unsupported', funAsrInstalled: false })).toEqual({
      kind: 'blocked',
      code: 'model_required'
    })
  })
})
