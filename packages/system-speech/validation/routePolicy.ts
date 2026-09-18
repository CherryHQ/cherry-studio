import type { AppleAssetStatus } from '../src/contracts'

export type AsrRoute =
  | { kind: 'apple' }
  | { kind: 'fun-asr' }
  | { kind: 'blocked'; code: 'asset_required' | 'model_required' | 'unsupported_locale' }

export interface AsrRouteInput {
  macOSMajor: number
  appleAssetStatus: AppleAssetStatus
  funAsrInstalled: boolean
}

export function selectAsrRoute(input: AsrRouteInput): AsrRoute {
  if (input.macOSMajor >= 26) {
    if (input.appleAssetStatus === 'installed') {
      return { kind: 'apple' }
    }
    if (input.appleAssetStatus === 'unsupported') {
      return { kind: 'blocked', code: 'unsupported_locale' }
    }
    return { kind: 'blocked', code: 'asset_required' }
  }

  return input.funAsrInstalled ? { kind: 'fun-asr' } : { kind: 'blocked', code: 'model_required' }
}
