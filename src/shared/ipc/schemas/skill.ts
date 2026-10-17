import * as z from 'zod'

import { AbsoluteFilePathSchema } from '@shared/types/file'
import {
  type InstalledSkill,
  type LocalSkill,
  type SkillCatalogEntry,
  SkillRemoteUpdateCheckSchema,
  type SkillResult,
  type SystemSkillCandidate
} from '@shared/types/skill'
import type {
  SkillSubscriptionSource,
  SkillSubscriptionSnapshot,
  MarketplaceInstallResult,
  MarketplaceSkillDetail,
  MarketplaceSkillPage
} from '@shared/types/skillMarketplace'

import { defineRoute } from '../define'
import { uint8ArraySchema } from './common'

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
  'skill.subscription.add': defineRoute({
    input: z.object({ url: z.string().trim().min(1) }),
    output: z.custom<SkillSubscriptionSource>()
  }),
  'skill.subscription.list': defineRoute({
    input: z.object({ sourceId: z.string().min(1) }),
    output: z.custom<SkillSubscriptionSnapshot | null>()
  }),
  'skill.subscription.refresh': defineRoute({
    input: z.object({ sourceId: z.string().min(1) }),
    output: z.custom<SkillSubscriptionSnapshot>()
  }),
  'skill.subscription.remove': defineRoute({ input: z.object({ sourceId: z.string().min(1) }), output: z.void() }),
  'skill.subscription.detail': defineRoute({
    input: z.object({ sourceId: z.string().min(1), itemId: z.string().min(1) }),
    output: z.custom<MarketplaceSkillDetail>()
  }),
  'skill.subscription.install': defineRoute({
    input: z.object({ sourceId: z.string().min(1), itemId: z.string().min(1) }),
    output: z.custom<MarketplaceInstallResult>()
  }),
  'skill.export': defineRoute({
    input: z.object({ skillId: z.string().min(1) }),
    output: uint8ArraySchema
  }),
  'skill.marketplace.list': defineRoute({
    input: z.object({ offset: z.number().int().nonnegative(), limit: z.number().int().min(1).max(100) }),
    output: z.custom<MarketplaceSkillPage>()
  }),
  'skill.marketplace.detail': defineRoute({
    input: z.object({ id: z.string().min(1) }),
    output: z.custom<MarketplaceSkillDetail>()
  }),
  'skill.marketplace.install': defineRoute({
    input: z.object({ id: z.string().min(1) }),
    output: z.custom<MarketplaceInstallResult>()
  }),
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
  'skill.list_catalog': defineRoute({
    input: z.object({ search: z.string().trim().min(1).optional() }),
    output: z.custom<SkillCatalogEntry[]>()
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
