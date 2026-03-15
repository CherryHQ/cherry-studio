export { ExecuteSchema, executeToolDefinition, handleExecute } from './execute'
export { handleOpen, OpenSchema, openToolDefinition } from './open'
export { handleReset, resetToolDefinition } from './reset'
export { handleSite, SiteSchema, siteToolDefinition } from './site'

import type { CdpBrowserController } from '../controller'
import { executeToolDefinition, handleExecute } from './execute'
import { handleOpen, openToolDefinition } from './open'
import { handleReset, resetToolDefinition } from './reset'
import { handleSite, siteToolDefinition } from './site'

export const toolDefinitions = [openToolDefinition, executeToolDefinition, resetToolDefinition, siteToolDefinition]

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
  site: handleSite
}
