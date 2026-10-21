// Stand-ins for the agent features the `ai.*` IPC handlers import that the Web edition leaves out:
// archiving (workspace archives), user workspaces, and the built-in assistant, skill and support sessions.
import { unsupported, unsupportedClass, unsupportedService } from './unsupported'

export const AgentSessionArchiveBusyError = unsupportedClass('Agent session archiving')
export const agentWorkspaceStorageService = unsupportedService('Agent workspaces')
export const createBuiltinAssistantSession = unsupported('Built-in assistant sessions')
export const createBuiltinSkillSession = unsupported('Built-in skill sessions')
export const createBuiltinSupportSession = unsupported('Built-in support sessions')
