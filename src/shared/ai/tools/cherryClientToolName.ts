export const CHERRY_CLIENT_TOOL_PREFIX = 'cherry_' as const

/** Add the namespace used only by Cherry function tools exposed through AI SDK. */
export function toCherryClientToolName<const TName extends string>(
  name: TName
): `${typeof CHERRY_CLIENT_TOOL_PREFIX}${TName}` {
  return `${CHERRY_CLIENT_TOOL_PREFIX}${name}`
}

export const CHERRY_TOOL_SEARCH_TOOL_NAME = toCherryClientToolName('tool_search')
export const CHERRY_TOOL_INSPECT_TOOL_NAME = toCherryClientToolName('tool_inspect')
export const CHERRY_TOOL_INVOKE_TOOL_NAME = toCherryClientToolName('tool_invoke')
export const CHERRY_TOOL_EXEC_TOOL_NAME = toCherryClientToolName('tool_exec')

export const CHERRY_META_TOOL_NAMES = [
  CHERRY_TOOL_SEARCH_TOOL_NAME,
  CHERRY_TOOL_INSPECT_TOOL_NAME,
  CHERRY_TOOL_INVOKE_TOOL_NAME,
  CHERRY_TOOL_EXEC_TOOL_NAME
] as const
