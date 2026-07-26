import type { InstalledSkill, LocalSkill, SkillResult, SystemSkillCandidate } from '@shared/types/skill'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Global-skills IPC schemas — install/uninstall/list of `.claude/skills` entries (a
 * filesystem-scoped concern, orthogonal to the SQLite-backed DataApi `/skills`).
 *
 * Legacy install/list routes keep the `SkillResult<T>` envelope: the handler catches and returns
 * `{ success, data } | { success, error }` (and logs on failure), and the renderer keeps
 * unwrapping it. New system-skill routes use IpcApi's native result/error contract and
 * therefore declare their data directly. Outputs are `z.custom` (IpcApi validates inputs,
 * not outputs). Skill_ReadFile / Skill_ListFiles stay on legacy IPC.
 */
export const skillRequestSchemas = {
  'skill.install': defineRoute({
    input: z.object({ installSource: z.string() }),
    output: z.custom<SkillResult<InstalledSkill>>()
  }),
  'skill.uninstall': defineRoute({
    input: z.object({ skillId: z.string() }),
    output: z.custom<SkillResult<void>>()
  }),
  'skill.install_from_zip': defineRoute({
    input: z.object({ zipFilePath: z.string() }),
    output: z.custom<SkillResult<InstalledSkill>>()
  }),
  'skill.install_from_directory': defineRoute({
    input: z.object({ directoryPath: z.string() }),
    output: z.custom<SkillResult<InstalledSkill>>()
  }),
  'skill.list_local': defineRoute({
    input: z.object({ workdir: z.string().min(1) }),
    output: z.custom<SkillResult<LocalSkill[]>>()
  }),
  'skill.discover_system': defineRoute({
    input: z.object({}),
    output: z.custom<SystemSkillCandidate[]>()
  }),
  'skill.import_system': defineRoute({
    input: z.object({ directoryPath: z.string().min(1) }),
    output: z.custom<InstalledSkill>()
  })
}
