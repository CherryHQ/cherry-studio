import { t } from '@main/i18n'

import { type ComfyuiRequestOptions, normalizeComfyuiBaseUrl, requestJson } from './comfyuiHttp'
import { WORKFLOW_DIR, WORKFLOW_FILE_EXTENSION } from './comfyuiWorkflows'

/** Reading a listing. Small body, but a large install can be slow to enumerate. */
const LIST_TIMEOUT_MS = 30 * 1000

interface UserDataEntry {
  name: string
  type: string
  /** Path relative to the user data root (`workflows/sub/x.json`); the listing
   * walks subdirectories, so `name` alone is only the basename. */
  path?: string
}

/**
 * What the ComfyUI server has saved, which is also what a user can generate
 * with: discovery is its own concern and does not go through the generation
 * transport, which submits, polls and cancels.
 *
 * Saved workflow names, newest first. Directories and non-workflow files are skipped.
 */
export async function listWorkflows(
  baseURL: string,
  signal?: AbortSignal,
  options: ComfyuiRequestOptions = {}
): Promise<string[]> {
  const entries = await requestJson<UserDataEntry[]>(
    `${normalizeComfyuiBaseUrl(baseURL)}/v2/userdata?path=${WORKFLOW_DIR}`,
    t('paintings.comfyui.list_failed'),
    signal,
    options,
    LIST_TIMEOUT_MS
  )
  const prefix = `${WORKFLOW_DIR}/`
  return entries
    .filter((entry) => entry.type === 'file' && entry.name.endsWith(WORKFLOW_FILE_EXTENSION))
    .map((entry) => {
      // The listing walks subdirectories, so a workflow in one arrives with the
      // basename in `name` and its real location in `path`. Keep the relative
      // path as the handle: it is what resolves again when the workflow is read
      // back and submitted.
      const relative = (entry.path ?? `${WORKFLOW_DIR}/${entry.name}`).replace(/^\/+/, '')
      const workflowPath = relative.startsWith(prefix) ? relative.slice(prefix.length) : relative
      return workflowPath.slice(0, -WORKFLOW_FILE_EXTENSION.length)
    })
}
