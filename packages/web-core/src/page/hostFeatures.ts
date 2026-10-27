// Browser `utils/hostFeatures`: the app is one tab, opens nothing on the computer, zooms and
// updates with the browser, has the browser's developer tools, stores no files or attachments, reads
// no Word documents, has no notes, knowledge bases, mini apps, voice, diagnostics, agent browser or
// computer use, and runs in the browser rather than as a desktop program.
import type { hostFeatures as desktopHostFeatures } from '@renderer/utils/hostFeatures'

export const hostFeatures: typeof desktopHostFeatures = {
  windows: false,
  systemApps: false,
  appZoom: false,
  appUpdates: false,
  devTools: false,
  imageUploads: false,
  attachments: false,
  documentText: false,
  notes: false,
  knowledgeBases: false,
  miniApps: false,
  voice: false,
  diagnostics: false,
  agentBrowser: false,
  computerUse: false,
  desktopApp: false,
  providerSignIn: false
}
