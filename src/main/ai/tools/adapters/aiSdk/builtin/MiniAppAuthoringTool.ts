/**
 * `mini_app` tool — the AI-SDK wrapper over the `miniAppAuthoring` core.
 *
 * Session identity comes from the request's `topicId`, workspace authorization from
 * its `roots`: the model never supplies either, which is what keeps a prompt from
 * talking its way into another session's previews or paths.
 */

import { tool } from 'ai'

import {
  MINI_APP_DESCRIPTION,
  MINI_APP_TOOL_NAME,
  miniAppAuthoringInputSchema,
  miniAppAuthoringOutputSchema,
  runMiniAppAuthoring
} from '../../../miniAppAuthoring'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export { MINI_APP_TOOL_NAME }

const miniAppTool = tool({
  description: MINI_APP_DESCRIPTION,
  inputSchema: miniAppAuthoringInputSchema,
  outputSchema: miniAppAuthoringOutputSchema,
  execute: async (input, options) => {
    const { request } = getToolCallContext(options)
    return runMiniAppAuthoring(input, { sessionId: request.topicId, roots: request.roots })
  }
})

export function createMiniAppToolEntry(): ToolEntry {
  return {
    name: MINI_APP_TOOL_NAME,
    namespace: 'miniapp',
    description: 'Validate, preview, inspect and close agent-authored Mini Apps',
    defer: 'never',
    tool: miniAppTool
  }
}
