export { ExecuteSchema, executeToolDefinition, handleExecute } from './execute'
export { handleOpen, OpenSchema, openToolDefinition } from './open'
export { handleReset, resetToolDefinition } from './reset'

import type { CdpBrowserController } from '../controller'
import { executeToolDefinition, handleExecute } from './execute'
import { handleOpen, openToolDefinition } from './open'
import { handleReset, resetToolDefinition } from './reset'

export const toolDefinitions = [openToolDefinition, executeToolDefinition, resetToolDefinition]

export const toolHandlers: Record<
  string,
  (
    controller: CdpBrowserController,
    args: unknown
  ) => Promise<{ content: { type: string; text: string }[]; isError: boolean }>
> = {
  open: handleOpen,
  execute: handleExecute,
  reset: handleReset
}
