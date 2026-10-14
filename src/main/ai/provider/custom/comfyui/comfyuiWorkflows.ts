import { loggerService } from '@logger'
import { createUniqueModelId } from '@shared/data/types/model'

const logger = loggerService.withContext('ComfyuiWorkflows')

/** Saved workflows live in this ComfyUI user-data directory, as `.json` files. */
export const WORKFLOW_DIR = 'workflows'
export const WORKFLOW_FILE_EXTENSION = '.json'

/**
 * A saved workflow is a model here, so its handle becomes the model's `apiModelId`:
 * whether it can be listed is whether that id can be built at all. A handle carrying a
 * reserved route character is refused by the id contract, and listing it anyway would
 * produce a row no consumer can turn into an id.
 */
export function isListableWorkflow(providerId: string, workflow: string): boolean {
  try {
    createUniqueModelId(providerId, workflow)
    return true
  } catch {
    return false
  }
}

/**
 * Split the server's saved workflows into the ones that become models and the ones the
 * id contract refuses. A skip the user cannot see reads as a workflow that vanished, so
 * the names travel with the list and the caller reports them; the log names the cause.
 */
export function partitionListableWorkflows(
  providerId: string,
  workflows: string[]
): { listed: string[]; skipped: string[] } {
  const listed: string[] = []
  const skipped: string[] = []
  for (const workflow of workflows) {
    if (isListableWorkflow(providerId, workflow)) {
      listed.push(workflow)
    } else {
      skipped.push(workflow)
    }
  }
  if (skipped.length > 0) {
    logger.warn('Skipped ComfyUI workflows whose names contain a reserved route character', { providerId, skipped })
  }
  return { listed, skipped }
}
