export const LegacyUpgradeChannels = {
  GetScreen: 'legacy-upgrade:get-screen',
  Download: 'legacy-upgrade:download',
  Quit: 'legacy-upgrade:quit'
} as const

export interface LegacyUpgradeScreen {
  title: string
  message: string
  detail: string
  prerequisite: string
  download: string
  downloadPrerequisite: string
  quit: string
  dark: boolean
}
