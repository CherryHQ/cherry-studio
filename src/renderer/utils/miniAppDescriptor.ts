import type { MiniApp, SiteMiniApp } from '@shared/data/types/miniApp'

export type MiniAppInput = Omit<SiteMiniApp, 'kind' | 'appId' | 'presetMiniAppId' | 'status' | 'orderKey'> & {
  appId: string
}

export function toTransientMiniApp(input: MiniAppInput): MiniApp {
  return {
    ...input,
    kind: 'site',
    appId: input.appId,
    presetMiniAppId: null,
    status: 'enabled',
    orderKey: ''
  }
}
