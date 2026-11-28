import { runtimeId } from '@cherrystudio/agent-runtime'

const SKILL_INPUT_PREFIX = 'skill-command:'

export function skillCommandInputId(requestId: string) {
  return runtimeId<'input'>(SKILL_INPUT_PREFIX + requestId)
}

export function isSkillCommandInput(inputId: string | undefined): boolean {
  return inputId?.startsWith(SKILL_INPUT_PREFIX) === true
}
