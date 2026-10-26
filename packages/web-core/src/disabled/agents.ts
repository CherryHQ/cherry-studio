// Stand-ins for the agent features the `ai.*` IPC handlers import that the Web edition leaves out:
// the built-in assistant, skill and support sessions.
import { unsupported } from './unsupported'

export const createBuiltinAssistantSession = unsupported('Built-in assistant sessions')
export const createBuiltinSkillSession = unsupported('Built-in skill sessions')
export const createBuiltinSupportSession = unsupported('Built-in support sessions')
