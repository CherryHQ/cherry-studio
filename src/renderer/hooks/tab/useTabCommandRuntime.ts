import { createContext, use, useMemo } from 'react'

import { CommandFocusHostContext, type CommandRuntime, useCommandRuntime } from '@renderer/hooks/command'

export const TabCommandRuntimeContext = createContext<CommandRuntime | null>(null)

export function useTabCommandRuntime(): CommandRuntime {
  const owner = use(TabCommandRuntimeContext)
  const host = use(CommandFocusHostContext)
  const runtime = useCommandRuntime()
  return useMemo(() => owner ?? (host ? host.forScope(host.rootScope) : runtime), [host, owner, runtime])
}
