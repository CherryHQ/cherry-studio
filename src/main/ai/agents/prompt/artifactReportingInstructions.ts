import { CHERRY_MCP_SERVER } from '@main/ai/toolApproval/builtinToolPolicy'
import { REPORT_ARTIFACTS_TOOL_NAME } from '@shared/ai/builtinTools'

import type { BuildAgentPromptOptions } from './buildAgentPrompt'

export function buildArtifactReportingInstructions(
  referenceTool: NonNullable<BuildAgentPromptOptions['referenceTool']>,
  toolCallHint = ''
): string | undefined {
  const report = referenceTool(CHERRY_MCP_SERVER.CHERRY_TOOLS, REPORT_ARTIFACTS_TOOL_NAME)
  if (!report) return undefined
  const text = `## Reporting deliverables

When you finish producing the file(s) the user asked for, call ${report} once as \`{ artifacts: [{ path, description }], summary }\`: each final file's path with a short name for it, and a one-line summary. List only the final deliverables — never intermediate, scratch, or temporary files. Skip the call entirely if the task produced no files.`
  return toolCallHint ? `${text}\n\n${toolCallHint}` : text
}
