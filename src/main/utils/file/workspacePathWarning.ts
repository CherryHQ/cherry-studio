import { t } from '@main/utils/language'

import { getPathStatus } from './pathStatus'

/**
 * Produce the user-visible warning for an agent workspace path, or `null` when
 * the path is a usable directory.
 *
 * This is the main-side home for *interpreting* a path-status failure into
 * display text: the errno lives in main and the rules for turning "this isn't a
 * valid workspace" into a message are main-side business. The renderer calls
 * this over IPC and shows the returned string verbatim — it does no error
 * classification of its own. Messages are i18n'd here via the main `t()`.
 */
export async function getWorkspacePathWarning(workspacePath: string): Promise<string | null> {
  const status = await getPathStatus(workspacePath, { expectedKind: 'directory' })
  if (status.ok) return null
  switch (status.reason) {
    case 'missing':
      return t('agent.session.workspace_status.missing', { path: workspacePath })
    case 'not-directory':
      return t('agent.session.workspace_status.not_directory', { path: workspacePath })
    // A workspace is always directory-expected, so `not-file` cannot occur; map
    // it (and any access failure) to the inaccessible message for exhaustiveness.
    case 'not-file':
    case 'inaccessible':
      return t('agent.session.workspace_status.inaccessible', { path: workspacePath })
  }
}
