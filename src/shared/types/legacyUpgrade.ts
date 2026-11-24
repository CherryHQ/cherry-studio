export const LegacyUpgradeChannels = {
  GetScreen: 'legacy-upgrade:get-screen',
  Download: 'legacy-upgrade:download',
  Quit: 'legacy-upgrade:quit',
  Install: 'legacy-upgrade:install',
  Cancel: 'legacy-upgrade:cancel',
  GetState: 'legacy-upgrade:get-state',
  State: 'legacy-upgrade:state'
} as const

export interface LegacyUpgradeScreen {
  title: string
  olderVersions: string
  detail: string
  prerequisite: string
  download: string
  downloadPrerequisite: string
  quit: string
  installation?: LegacyInstallCopy
  dark: boolean
}

export type LegacyInstallState =
  | { phase: 'idle' | 'preparing' | 'installing' | 'failed' | 'cancelling' }
  | { phase: 'downloading'; percent?: number }

export interface LegacyInstallCopy {
  enabled: boolean
  prerequisite: boolean
  action: string
  detail: string
  cancel: string
  retry: string
  preparing: string
  downloading: string
  installing: string
  failed: string
}
