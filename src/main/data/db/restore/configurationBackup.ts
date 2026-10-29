import { eq, sql } from 'drizzle-orm'
import { omit } from 'es-toolkit'
import * as z from 'zod'

import { AgentConfigurationSchema, AgentTypeSchema } from '@shared/data/api/schemas/agents'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { AssistantSettingsSchema } from '@shared/data/types/assistant'
import {
  ENDPOINT_TYPE,
  MODALITY,
  MODEL_CAPABILITY,
  objectValues,
  ParameterSupportDbSchema,
  ReasoningConfigSchema,
  RuntimeModelPricingSchema
} from '@shared/data/types/model'
import { PromptBindingTargetTypeSchema, PromptVisibilitySchema } from '@shared/data/types/prompt'
import {
  ApiKeyEntrySchema,
  AuthConfigSchema,
  EndpointConfigOverrideSchema,
  ProviderSettingsSchema
} from '@shared/data/types/provider'
import type { AppEdition } from '@shared/types/appEdition'
import { BACKUP_CONFIGURATION_CONFLICT, BACKUP_CONFIGURATION_INVALID } from '@shared/types/backup'

import { agentTable } from '../schemas/agent'
import { assistantTable } from '../schemas/assistant'
import { groupTable } from '../schemas/group'
import { preferenceTable } from '../schemas/preference'
import { promptBindingTable, promptTable } from '../schemas/prompt'
import { translateLanguageTable } from '../schemas/translateLanguage'
import { userModelTable } from '../schemas/userModel'
import { userProviderTable } from '../schemas/userProvider'
import type { DbOrTx } from '../types'
import type { AppliedMigration } from './appliedChain'

const excludedPreferences = new Set(['chat.save.knowledge.last_base_id', 'ui.sidebar_shortcut', 'ui.sidebar.favorites'])
export const CONFIGURATION_PREFERENCE_KEYS = Object.freeze(
  Object.keys(DefaultPreferences.default).filter((key) => !excludedPreferences.has(key))
)

const agentConfigurationSchema = AgentConfigurationSchema.pick({
  avatar: true,
  permission_mode: true,
  reasoning_effort: true,
  service_tier: true,
  env_vars: true,
  language: true
}).strict()
const agentConfigurationKeys = Object.freeze(Object.keys(agentConfigurationSchema.shape))
const text = z.string()
const timestamp = z.number().int().nonnegative()
const timestamps = { createdAt: timestamp, updatedAt: timestamp }
const endpoint = z.enum(objectValues(ENDPOINT_TYPE))

// Validate existing JSON contracts without stripping extension fields or applying defaults.
const storedJson = <S extends z.ZodType>(schema: S) => z.custom<z.infer<S>>((value) => schema.safeParse(value).success)

// Format 1's frozen field allowlist. Adding a DB column never adds an exported field.
export const CONFIGURATION_ROW_SCHEMAS = Object.freeze({
  user_provider: z.strictObject({
    providerId: text,
    presetProviderId: text.nullable(),
    name: text,
    logoKey: text.nullable(),
    endpointConfigs: storedJson(
      z.partialRecord(endpoint, EndpointConfigOverrideSchema.extend({ adapterFamily: text.optional() }))
    ).nullable(),
    defaultChatEndpoint: endpoint.nullable(),
    apiKeys: storedJson(z.array(ApiKeyEntrySchema)).nullable(),
    authConfig: storedJson(AuthConfigSchema).nullable(),
    providerSettings: storedJson(ProviderSettingsSchema).nullable(),
    isEnabled: z.boolean(),
    orderKey: text,
    ...timestamps
  }),
  user_model: z.strictObject({
    id: text,
    providerId: text,
    modelId: text,
    presetModelId: text.nullable(),
    name: text.nullable(),
    description: text.nullable(),
    group: text.nullable(),
    capabilities: z.array(z.enum(objectValues(MODEL_CAPABILITY))).nullable(),
    inputModalities: z.array(z.enum(objectValues(MODALITY))).nullable(),
    inputModalitiesExplicit: z.boolean(),
    outputModalities: z.array(z.enum(objectValues(MODALITY))).nullable(),
    endpointTypes: z.array(endpoint).nullable(),
    contextWindow: z.number().int().nullable(),
    maxInputTokens: z.number().int().nullable(),
    maxOutputTokens: z.number().int().nullable(),
    supportsStreaming: z.boolean().nullable(),
    reasoning: storedJson(ReasoningConfigSchema).nullable(),
    parameters: storedJson(ParameterSupportDbSchema).nullable(),
    pricing: storedJson(RuntimeModelPricingSchema).nullable(),
    isEnabled: z.boolean(),
    isHidden: z.boolean(),
    isDeprecated: z.boolean(),
    orderKey: text,
    notes: text.nullable(),
    ...timestamps
  }),
  assistant: z.strictObject({
    id: text,
    name: text,
    prompt: text,
    emoji: text,
    description: text,
    modelId: text.nullable(),
    groupId: text.nullable(),
    settings: storedJson(AssistantSettingsSchema),
    orderKey: text,
    ...timestamps,
    deletedAt: timestamp.nullable()
  }),
  agent: z.strictObject({
    id: text,
    type: AgentTypeSchema,
    name: text,
    description: text,
    instructions: text,
    model: text.nullable(),
    planModel: text.nullable(),
    smallModel: text.nullable(),
    disabledTools: z.array(text),
    configuration: storedJson(agentConfigurationSchema),
    orderKey: text,
    ...timestamps,
    deletedAt: timestamp.nullable()
  }),
  preference: z.strictObject({ scope: z.literal('default'), key: text, value: storedJson(z.json()) }),
  group: z.strictObject({ id: text, entityType: z.literal('assistant'), name: text, orderKey: text, ...timestamps }),
  prompt: z.strictObject({
    id: text,
    title: text,
    content: text,
    visibility: PromptVisibilitySchema,
    orderKey: text,
    ...timestamps
  }),
  prompt_binding: z.strictObject({
    promptId: text,
    targetType: PromptBindingTargetTypeSchema,
    targetId: text,
    orderKey: text,
    ...timestamps
  }),
  translate_language: z.strictObject({ langCode: text, value: text, emoji: text, ...timestamps })
})

const payloadSchema = z.strictObject({
  formatVersion: z.literal(1),
  edition: z.enum(['global', 'cn']),
  migrationChain: z.array(z.strictObject({ folderMillis: timestamp, hash: text.min(1) })).min(1),
  tables: z.strictObject({
    user_provider: z.array(CONFIGURATION_ROW_SCHEMAS.user_provider),
    user_model: z.array(CONFIGURATION_ROW_SCHEMAS.user_model),
    assistant: z.array(CONFIGURATION_ROW_SCHEMAS.assistant),
    agent: z.array(CONFIGURATION_ROW_SCHEMAS.agent),
    preference: z.array(CONFIGURATION_ROW_SCHEMAS.preference),
    group: z.array(CONFIGURATION_ROW_SCHEMAS.group),
    prompt: z.array(CONFIGURATION_ROW_SCHEMAS.prompt),
    prompt_binding: z.array(CONFIGURATION_ROW_SCHEMAS.prompt_binding),
    translate_language: z.array(CONFIGURATION_ROW_SCHEMAS.translate_language)
  })
})
export type ConfigurationPayload = z.infer<typeof payloadSchema>

function invalid(reason: string): never {
  throw new Error(`${BACKUP_CONFIGURATION_INVALID}: ${reason}`)
}

export function readConfigurationMigrationChain(db: DbOrTx): AppliedMigration[] {
  return db.all<{ folderMillis: number; hash: string }>(
    sql`SELECT created_at AS folderMillis, hash FROM __drizzle_migrations ORDER BY created_at`
  )
}

export function validateConfigurationPayload(raw: unknown): ConfigurationPayload {
  try {
    return parseConfigurationPayload(raw)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(BACKUP_CONFIGURATION_INVALID)) throw error
    invalid('Malformed configuration JSON')
  }
}

function parseConfigurationPayload(raw: unknown): ConfigurationPayload {
  if (!z.json().safeParse(raw).success) invalid('Non-finite or non-JSON value')
  const parsed = payloadSchema.safeParse(raw)
  if (!parsed.success) invalid('Unexpected section, field or field type')
  const payload = parsed.data
  const tables = payload.tables
  const identities = {
    user_provider: tables.user_provider.map((row) => row.providerId),
    user_model: tables.user_model.map((row) => row.id),
    assistant: tables.assistant.map((row) => row.id),
    agent: tables.agent.map((row) => row.id),
    preference: tables.preference.map((row) => row.key),
    group: tables.group.map((row) => row.id),
    prompt: tables.prompt.map((row) => row.id),
    prompt_binding: tables.prompt_binding.map((row) => JSON.stringify([row.promptId, row.targetType, row.targetId])),
    translate_language: tables.translate_language.map((row) => row.langCode)
  }
  for (const [section, keys] of Object.entries(identities)) {
    if (new Set(keys).size !== keys.length) invalid(`Duplicate identity in ${section}`)
  }
  const preferenceKeys = new Set(identities.preference)
  if (
    preferenceKeys.size !== CONFIGURATION_PREFERENCE_KEYS.length ||
    !CONFIGURATION_PREFERENCE_KEYS.every((key) => preferenceKeys.has(key))
  )
    invalid('Incomplete preference key set')
  const providers = new Set(identities.user_provider)
  const models = new Set(identities.user_model)
  const groups = new Set(identities.group)
  const prompts = new Set(identities.prompt)
  const targets = { assistant: new Set(identities.assistant), agent: new Set(identities.agent) }
  const reference = (id: string | null, parents: Set<string>, section: string) => {
    if (id !== null && !parents.has(id)) invalid(`Unresolved reference in ${section}`)
  }
  for (const row of tables.user_model) {
    if (row.id !== `${row.providerId}::${row.modelId}`) invalid('Invalid user_model identity')
    if (
      row.presetModelId === null &&
      (row.name === null || row.capabilities === null || row.supportsStreaming === null)
    ) {
      invalid('Incomplete custom user_model')
    }
    reference(row.providerId, providers, 'user_model')
  }
  for (const row of tables.assistant) {
    reference(row.modelId, models, 'assistant')
    reference(row.groupId, groups, 'assistant')
  }
  for (const row of tables.agent) {
    for (const id of [row.model, row.planModel, row.smallModel]) reference(id, models, 'agent')
  }
  for (const row of tables.prompt_binding) {
    reference(row.promptId, prompts, 'prompt_binding')
    reference(row.targetId, targets[row.targetType], 'prompt_binding')
  }
  return payload
}

function project<T extends object>(row: T, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key as keyof T]]))
}

export function captureConfiguration(db: DbOrTx, edition: AppEdition): ConfigurationPayload {
  const preferences = new Map(
    db
      .select()
      .from(preferenceTable)
      .where(eq(preferenceTable.scope, 'default'))
      .all()
      .map((row) => [row.key, row.value])
  )
  const rows = {
    user_provider: db.select().from(userProviderTable).all(),
    user_model: db.select().from(userModelTable).all(),
    assistant: db.select().from(assistantTable).all(),
    agent: db
      .select()
      .from(agentTable)
      .all()
      .map((row) => ({
        ...row,
        configuration: project(row.configuration, agentConfigurationKeys)
      })),
    preference: CONFIGURATION_PREFERENCE_KEYS.map((key) => ({
      scope: 'default',
      key,
      value: preferences.has(key)
        ? preferences.get(key)
        : DefaultPreferences.default[key as keyof typeof DefaultPreferences.default]
    })),
    group: db.select().from(groupTable).where(eq(groupTable.entityType, 'assistant')).all(),
    prompt: db.select().from(promptTable).all(),
    prompt_binding: db.select().from(promptBindingTable).all(),
    translate_language: db.select().from(translateLanguageTable).all()
  }
  const tables = Object.fromEntries(
    Object.entries(rows).map(([section, records]) => [
      section,
      records.map((row) => project(row, Object.keys(CONFIGURATION_ROW_SCHEMAS[section as keyof typeof rows].shape)))
    ])
  )
  return validateConfigurationPayload({
    formatVersion: 1,
    edition,
    migrationChain: readConfigurationMigrationChain(db),
    tables
  })
}

function updateFields<T extends { createdAt: number }>(row: T): Omit<T, 'createdAt'> {
  return omit(row, ['createdAt'])
}

export function applyConfigurationTx(tx: DbOrTx, payload: ConfigurationPayload): void {
  const { tables } = validateConfigurationPayload(payload)
  const agents = new Map(
    tx
      .select()
      .from(agentTable)
      .all()
      .map((row) => [row.id, row])
  )
  const groups = new Map(
    tx
      .select()
      .from(groupTable)
      .all()
      .map((row) => [row.id, row])
  )
  const models = tx.select().from(userModelTable).all()
  const modelsById = new Map(models.map((row) => [row.id, row]))
  const modelsByIdentity = new Map(models.map((row) => [JSON.stringify([row.providerId, row.modelId]), row.id]))
  for (const row of tables.agent) {
    if (agents.has(row.id) && agents.get(row.id)!.type !== row.type) {
      throw new Error(`${BACKUP_CONFIGURATION_CONFLICT}: agent runtime type collision`)
    }
  }
  for (const row of tables.group) {
    if (groups.has(row.id) && groups.get(row.id)!.entityType !== 'assistant') {
      throw new Error(`${BACKUP_CONFIGURATION_CONFLICT}: group entity type collision`)
    }
  }
  for (const row of tables.user_model) {
    const target = modelsById.get(row.id)
    const identity = modelsByIdentity.get(JSON.stringify([row.providerId, row.modelId]))
    if (
      (target && (target.providerId !== row.providerId || target.modelId !== row.modelId)) ||
      (identity !== undefined && identity !== row.id)
    ) {
      throw new Error(`${BACKUP_CONFIGURATION_CONFLICT}: user_model identity collision`)
    }
  }
  for (const row of tables.user_provider)
    tx.insert(userProviderTable)
      .values(row)
      .onConflictDoUpdate({ target: userProviderTable.providerId, set: updateFields(row) })
      .run()
  for (const row of tables.user_model)
    tx.insert(userModelTable)
      .values(row)
      .onConflictDoUpdate({ target: userModelTable.id, set: updateFields(row) })
      .run()
  for (const row of tables.group)
    tx.insert(groupTable)
      .values(row)
      .onConflictDoUpdate({ target: groupTable.id, set: updateFields(row) })
      .run()
  for (const row of tables.assistant) {
    const fields = omit(row, ['createdAt', 'deletedAt'])
    tx.insert(assistantTable).values(row).onConflictDoUpdate({ target: assistantTable.id, set: fields }).run()
  }
  for (const row of tables.agent) {
    const configuration = { ...agents.get(row.id)?.configuration }
    for (const key of agentConfigurationKeys) delete configuration[key]
    Object.assign(configuration, row.configuration)
    const fields = omit(row, ['createdAt', 'deletedAt'])
    tx.insert(agentTable)
      .values(row)
      .onConflictDoUpdate({ target: agentTable.id, set: { ...fields, configuration } })
      .run()
  }
  for (const row of tables.prompt)
    tx.insert(promptTable)
      .values(row)
      .onConflictDoUpdate({ target: promptTable.id, set: updateFields(row) })
      .run()
  for (const row of tables.prompt_binding)
    tx.insert(promptBindingTable)
      .values(row)
      .onConflictDoUpdate({
        target: [promptBindingTable.promptId, promptBindingTable.targetType, promptBindingTable.targetId],
        set: updateFields(row)
      })
      .run()
  for (const row of tables.translate_language)
    tx.insert(translateLanguageTable)
      .values(row)
      .onConflictDoUpdate({ target: translateLanguageTable.langCode, set: updateFields(row) })
      .run()
  for (const row of tables.preference)
    tx.insert(preferenceTable)
      .values(row)
      .onConflictDoUpdate({
        target: [preferenceTable.scope, preferenceTable.key],
        set: { value: row.value, updatedAt: Date.now() }
      })
      .run()
  if (tx.all(sql`PRAGMA foreign_key_check`).length)
    throw new Error(`${BACKUP_CONFIGURATION_CONFLICT}: Relational integrity check failed`)
  const targets = {
    assistant: new Set(
      tx
        .select({ id: assistantTable.id })
        .from(assistantTable)
        .all()
        .map((row) => row.id)
    ),
    agent: new Set(
      tx
        .select({ id: agentTable.id })
        .from(agentTable)
        .all()
        .map((row) => row.id)
    )
  }
  for (const row of tables.prompt_binding) {
    if (!targets[row.targetType].has(row.targetId)) {
      throw new Error(`${BACKUP_CONFIGURATION_CONFLICT}: prompt_binding target is missing after import`)
    }
  }
}
