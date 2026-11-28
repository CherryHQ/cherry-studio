import { runtimeId } from '@cherrystudio/agent-runtime'

export const SKILL_COMMAND_PREFIX = 'skill:'
const SKILL_INPUT_PREFIX = 'skill-command:'

export function skillCommandInputId(requestId: string) {
  return runtimeId<'input'>(SKILL_INPUT_PREFIX + requestId)
}

export function isSkillCommandInput(inputId: string | undefined): boolean {
  return inputId?.startsWith(SKILL_INPUT_PREFIX) === true
}

export function buildSkillCommandPrompt(descriptorPath: string, args: string): string {
  const instruction = `Read the Skill instructions at ${JSON.stringify(descriptorPath)} and use them for this request. Resolve any relative Skill files from the directory containing those instructions.`
  return args ? `${instruction}\n\n${args}` : instruction
}
