// The names `builtinToolPolicyRegistry` imports from tool modules that need Electron, a shell or native
// code. Those tools do not run in the Web edition, so their approval entries never match a call.
export const MOVE_TO_TRASH_TOOL_NAME = 'move_to_trash'
export const SAVE_ATTACHMENT_TOOL_NAME = 'save_attachment'
export const computerUseToolDefinitions: ReadonlyArray<{ name: string }> = []
