export interface FileOpenActions {
  /** Open a file in the in-app artifact preview pane. */
  openArtifactFile?: (path: string) => void | Promise<void>
  /** Open a path in the system file manager (used for directories, or when no preview pane exists). */
  openPath?: (path: string) => void | Promise<void>
  /** Authoritative directory check (fs.stat-backed; resolves false on a missing path). */
  isDirectory?: (path: string) => Promise<boolean>
  /** Invoked when opening throws. */
  onError?: () => void
}

/**
 * Canonical file-path open routing, shared by `ClickableFilePath` and the markdown
 * host's `openFilePath`. Directories open in the system file manager (`openPath`);
 * files open in the in-app artifact preview (`openArtifactFile`). Surfaces that wire
 * only `openPath` (e.g. Home chat, which has no preview pane) route everything through
 * the file manager so the link is never a silent dead end. Never rejects — failures
 * invoke `onError`.
 */
export async function openFileTarget(path: string, actions: FileOpenActions): Promise<void> {
  try {
    const directory = actions.isDirectory ? await actions.isDirectory(path) : false
    if (directory || !actions.openArtifactFile) {
      await actions.openPath?.(path)
    } else {
      await actions.openArtifactFile(path)
    }
  } catch {
    actions.onError?.()
  }
}
