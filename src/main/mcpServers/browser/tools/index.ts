export { ExecuteSchema, executeToolDefinition, handleExecute } from './execute'
export { FetchSchema, fetchToolDefinition, handleFetch } from './fetch'
export { handleOpen, OpenSchema, openToolDefinition } from './open'
export { handleReset, resetToolDefinition } from './reset'

import { executeToolDefinition } from './execute'
import { fetchToolDefinition } from './fetch'
import { openToolDefinition } from './open'
import { resetToolDefinition } from './reset'

export const toolDefinitions = [openToolDefinition, executeToolDefinition, resetToolDefinition, fetchToolDefinition]
