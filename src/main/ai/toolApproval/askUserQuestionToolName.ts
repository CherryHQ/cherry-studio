export const ASK_USER_QUESTION_TOOL_NAME = 'AskUserQuestion'

// Match the two names accepted by the renderer's isAskUserQuestionToolName.
export function isAskUserQuestionToolName(toolName: string | undefined): boolean {
  return toolName === ASK_USER_QUESTION_TOOL_NAME || toolName === `builtin_${ASK_USER_QUESTION_TOOL_NAME}`
}
