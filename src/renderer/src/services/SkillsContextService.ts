import { loggerService } from '@logger'
import type { AttachedSkill } from '@renderer/types'
import type { SystemModelMessage } from 'ai'

const logger = loggerService.withContext('SkillsContextService')

export type AttachedSkillBody = {
  folderName: string
  name: string
  description?: string
  body: string
}

export function formatAttachedSkillsSystemPrompt(skills: AttachedSkillBody[]): string {
  const items = skills
    .map((skill) => {
      const header = `【技能】${skill.name}${skill.description ? ` - ${skill.description}` : ''}`
      return `${header}\n${skill.body.trim()}\n`
    })
    .join('\n')
    .trim()

  return [
    '以下内容为用户在输入栏“附加技能”中选择的技能（持续生效，直到用户移除标签）。',
    '请在回答时遵循其中适用的指令与约束。',
    '',
    items
  ]
    .filter(Boolean)
    .join('\n')
    .trim()
}

export async function buildAttachedSkillsSystemMessage(
  attachedSkills: AttachedSkill[] | undefined
): Promise<SystemModelMessage | null> {
  const selected = (attachedSkills ?? []).filter((s) => s.folderName && (s.name || s.folderName))
  if (selected.length === 0) {
    return null
  }

  const resolved: AttachedSkillBody[] = []

  for (const skill of selected) {
    try {
      const result = await window.api.skills.readBody({ folderName: skill.folderName })
      if (!result.success) {
        logger.warn('读取附加技能失败，已跳过', { folderName: skill.folderName, error: result.error })
        continue
      }
      const body = (result.data || '').trim()
      if (!body) {
        continue
      }
      resolved.push({
        folderName: skill.folderName,
        name: skill.name || skill.folderName,
        description: skill.description,
        body
      })
    } catch (error) {
      logger.warn('读取附加技能异常，已跳过', {
        folderName: skill.folderName,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  if (resolved.length === 0) {
    return null
  }

  const prompt = formatAttachedSkillsSystemPrompt(resolved)
  return {
    role: 'system',
    content: prompt
  }
}
