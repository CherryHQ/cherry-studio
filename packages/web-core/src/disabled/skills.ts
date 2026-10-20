// Stand-ins for `ai/skills/SkillService` and `utils/builtinSkills`: skills are desktop-only.
import { unsupported, unsupportedService } from './unsupported'

export const skillService = unsupportedService('Skills')
export const installBuiltinSkills = unsupported('Built-in skills')
