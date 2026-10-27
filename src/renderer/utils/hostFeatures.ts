/**
 * What the app around the renderer can do. The desktop app can do all of it; the Web edition
 * (`packages/web-core`) replaces this module with what a browser tab can do.
 */
export const hostFeatures = {
  /** More app windows: a tab or conversation moved or opened into its own window. */
  windows: true,
  /** Opening files and folders in the system's file manager and other apps. */
  systemApps: true,
  /** App zoom, which a browser does itself. */
  appZoom: true,
  /** Checking for and installing app updates. */
  appUpdates: true,
  /** Developer tools. */
  devTools: true,
  /** Storing uploaded images, such as a provider's logo. */
  imageUploads: true,
  /** Files attached to messages, copied into the app's file storage. */
  attachments: true,
  /** Reading a Word document's text, with the desktop's document parser. */
  documentText: true,
  /** Notes, kept as files in a folder on the computer. */
  notes: true,
  /** Knowledge bases, which index files with the desktop's native libraries. */
  knowledgeBases: true,
  /** Mini apps, websites the desktop shows in its own web views. */
  miniApps: true,
  /** Dictation and reading replies aloud, which run speech models in the desktop app. */
  voice: true,
  /** Diagnostics (Doctor) and problem reports, which check and collect the install, logs and network. */
  diagnostics: true,
  /** The built-in browser pane, a web view that agents can drive. */
  agentBrowser: true,
  /** Computer use: agents see and control the computer's apps. */
  computerUse: true,
  /** Settings of the desktop program: start at login, tray, its own proxy, GPU and power use, native menus. */
  desktopApp: true,
  /** Provider sign-ins through a CLI, an app login or GitHub's device login, which report back to the app. */
  providerSignIn: true,
  /** The built-in CherryAI model, which needs the client secret built into the desktop app. */
  builtinModel: true
}
