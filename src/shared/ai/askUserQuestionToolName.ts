export const ASK_USER_QUESTION_TOOL_NAME = 'AskUserQuestion'

export function isAskUserQuestionToolName(toolName: unknown): boolean {
  return toolName === ASK_USER_QUESTION_TOOL_NAME || toolName === `builtin_${ASK_USER_QUESTION_TOOL_NAME}`
}
