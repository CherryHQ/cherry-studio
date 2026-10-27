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
  /** Notes, kept as files in a folder on the computer. */
  notes: true,
  /** Knowledge bases, which index files with the desktop's native libraries. */
  knowledgeBases: true
}
