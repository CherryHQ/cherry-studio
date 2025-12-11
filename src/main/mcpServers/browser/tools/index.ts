export { ExecuteSchema, executeToolDefinition, handleExecute } from './execute'
export { FetchSchema, fetchToolDefinition, handleFetch } from './fetch'
export { handleOpen, OpenSchema, openToolDefinition } from './open'
export { handleReset, resetToolDefinition } from './reset'

import type { CdpBrowserController } from '../controller'
import { executeToolDefinition, handleExecute } from './execute'
import { fetchToolDefinition, handleFetch } from './fetch'
import { handleOpen, openToolDefinition } from './open'
import { handleReset, resetToolDefinition } from './reset'

export const toolDefinitions = [openToolDefinition, executeToolDefinition, resetToolDefinition, fetchToolDefinition]

export const toolHandlers: Record<
  string,
  (
    controller: CdpBrowserController,
    args: unknown
  ) => Promise<{ content: { type: string; text: string }[]; isError: boolean }>
> = {
  open: handleOpen,
  execute: handleExecute,
  reset: handleReset,
  fetch: handleFetch
}
