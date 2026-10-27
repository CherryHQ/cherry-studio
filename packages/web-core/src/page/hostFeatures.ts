// Browser `utils/hostFeatures`: the app is one tab, opens nothing on the computer, zooms and
// updates with the browser, has the browser's developer tools, stores no files, has no notes,
// knowledge bases, diagnostics, agent browser or computer use, and runs in the browser rather than as a
// desktop program.
import type { hostFeatures as desktopHostFeatures } from '@renderer/utils/hostFeatures'

export const hostFeatures: typeof desktopHostFeatures = {
  windows: false,
  systemApps: false,
  appZoom: false,
  appUpdates: false,
  devTools: false,
  imageUploads: false,
  notes: false,
  knowledgeBases: false,
  diagnostics: false,
  agentBrowser: false,
  computerUse: false,
  desktopApp: false,
  providerSignIn: false
}
