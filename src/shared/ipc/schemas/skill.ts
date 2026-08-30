import { AbsoluteFilePathSchema } from '@shared/types/file'
import {
  type InstalledSkill,
  type LocalSkill,
  SkillRemoteUpdateCheckSchema,
  type SkillResult,
  type SystemSkillCandidate
} from '@shared/types/skill'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Global-skills IPC schemas — install/uninstall/list of `.claude/skills` entries (a
 * filesystem-scoped concern, orthogonal to the SQLite-backed DataApi `/skills`).
 *
 * Legacy install/list routes keep the `SkillResult<T>` envelope: the handler catches and returns
 * `{ success, data } | { success, error }` (and logs on failure), and the renderer keeps
 * unwrapping it. New routes use IpcApi's native result/error contract and
 * therefore declare their data directly. Legacy outputs remain `z.custom` because IpcApi
 * validates inputs, not outputs.
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
  'skill.reconcile': defineRoute({
    input: z.strictObject({ skillId: z.string().min(1).optional() }),
    output: z.custom<void>()
  }),
  'skill.remote.check': defineRoute({
    input: z.strictObject({ skillId: z.string().min(1) }),
    output: SkillRemoteUpdateCheckSchema
  }),
  'skill.remote.apply': defineRoute({
    input: z.strictObject({
      skillId: z.string().min(1),
      revision: z.string().min(1),
      overwriteLocalChanges: z.boolean()
    }),
    output: z.custom<InstalledSkill>()
  }),
  'skill.discover_system': defineRoute({
    input: z.object({}),
    output: z.custom<SystemSkillCandidate[]>()
  }),
  'skill.import_system': defineRoute({
    input: z.object({ directoryPath: z.string().min(1) }),
    output: z.custom<InstalledSkill>()
  }),
  'skill.folder.open': defineRoute({
    input: z.object({ skillId: z.string().min(1) }),
    output: z.void()
  }),
  'skill.folder.resolve': defineRoute({
    input: z.strictObject({ skillId: z.string().min(1) }),
    output: z.discriminatedUnion('access', [
      z.strictObject({ rootPath: AbsoluteFilePathSchema, access: z.literal('read_write') }),
      z.strictObject({
        rootPath: AbsoluteFilePathSchema,
        access: z.literal('read_only'),
        readOnlyReason: z.literal('builtin')
      })
    ])
  })
}
