// Stand-ins for the agent entry points the `ai.*` IPC handlers import; the agent gets its own Web Spec.
import { unsupported, unsupportedClass, unsupportedService } from './unsupported'

export const AgentSessionArchiveBusyError = unsupportedClass('Agent session archiving')
export const AgentSessionForkError = unsupportedClass('Agent session forks')
export const agentWorkspaceStorageService = unsupportedService('Agent workspaces')
export const createAgent = unsupported('Agents')
export const createBuiltinAssistantSession = unsupported('Built-in assistant sessions')
export const createBuiltinSkillSession = unsupported('Built-in skill sessions')
export const createBuiltinSupportSession = unsupported('Built-in support sessions')
