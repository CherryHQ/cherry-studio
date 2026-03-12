/**
 * Enum String-to-Number Migrator
 *
 * Converts legacy string enum values stored in user_model JSON columns
 * to proto numeric enum values.
 *
 * This handles the case where user_model rows were created before the
 * proto types unification (when enums were stored as strings like
 * "function_call" instead of numbers like 1).
 *
 * Affected columns: capabilities, inputModalities, outputModalities, endpointTypes
 */

import { EndpointType, Modality, ModelCapability } from '@cherrystudio/provider-catalog'
import { userModelTable } from '@data/db/schemas/userModel'
import { loggerService } from '@logger'
import { sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

const logger = loggerService.withContext('EnumStringToNumberMigrator')

// ─── String → Number maps ──────────────────────────────────────────────────

const CAPABILITY_MAP: Record<string, number> = {
  function_call: ModelCapability.FUNCTION_CALL,
  reasoning: ModelCapability.REASONING,
  image_recognition: ModelCapability.IMAGE_RECOGNITION,
  image_generation: ModelCapability.IMAGE_GENERATION,
  audio_recognition: ModelCapability.AUDIO_RECOGNITION,
  audio_generation: ModelCapability.AUDIO_GENERATION,
  embedding: ModelCapability.EMBEDDING,
  rerank: ModelCapability.RERANK,
  audio_transcript: ModelCapability.AUDIO_TRANSCRIPT,
  video_recognition: ModelCapability.VIDEO_RECOGNITION,
  video_generation: ModelCapability.VIDEO_GENERATION,
  structured_output: ModelCapability.STRUCTURED_OUTPUT,
  file_input: ModelCapability.FILE_INPUT,
  web_search: ModelCapability.WEB_SEARCH,
  code_execution: ModelCapability.CODE_EXECUTION,
  file_search: ModelCapability.FILE_SEARCH,
  computer_use: ModelCapability.COMPUTER_USE
}

const MODALITY_MAP: Record<string, number> = {
  TEXT: Modality.TEXT,
  IMAGE: Modality.IMAGE,
  AUDIO: Modality.AUDIO,
  VIDEO: Modality.VIDEO,
  VECTOR: Modality.VECTOR
}

const ENDPOINT_TYPE_MAP: Record<string, number> = {
  chat_completions: EndpointType.CHAT_COMPLETIONS,
  text_completions: EndpointType.TEXT_COMPLETIONS,
  messages: EndpointType.MESSAGES,
  responses: EndpointType.RESPONSES,
  generate_content: EndpointType.GENERATE_CONTENT,
  ollama_chat: EndpointType.OLLAMA_CHAT,
  ollama_generate: EndpointType.OLLAMA_GENERATE,
  embeddings: EndpointType.EMBEDDINGS,
  rerank: EndpointType.RERANK,
  image_generation: EndpointType.IMAGE_GENERATION,
  image_edit: EndpointType.IMAGE_EDIT,
  audio_transcription: EndpointType.AUDIO_TRANSCRIPTION,
  audio_translation: EndpointType.AUDIO_TRANSLATION,
  text_to_speech: EndpointType.TEXT_TO_SPEECH,
  video_generation: EndpointType.VIDEO_GENERATION
}

// ─── Migration logic ────────────────────────────────────────────────────────

/**
 * Convert a JSON array of string enum values to numeric values.
 * Returns null if no conversion needed (already numeric or null).
 */
function convertEnumArray(jsonStr: string | null | undefined, mapping: Record<string, number>): number[] | null {
  if (!jsonStr) return null

  let arr: unknown[]
  try {
    arr = JSON.parse(jsonStr)
  } catch {
    return null
  }

  if (!Array.isArray(arr) || arr.length === 0) return null

  // Check if already numeric
  if (typeof arr[0] === 'number') return null

  // Convert strings to numbers
  const result: number[] = []
  for (const item of arr) {
    if (typeof item === 'string') {
      const num = mapping[item]
      if (num !== undefined) {
        result.push(num)
      }
    }
  }

  return result.length > 0 ? result : null
}

/**
 * Migrate all user_model rows that contain string enum values to numeric.
 *
 * Safe to call multiple times — rows with numeric values are skipped.
 *
 * @returns Number of rows updated
 */
export async function migrateEnumStringsToNumbers(db: BetterSQLite3Database): Promise<number> {
  const rows = await db
    .select({
      providerId: userModelTable.providerId,
      modelId: userModelTable.modelId,
      capabilities: sql<string>`capabilities`.as('capabilities_raw'),
      inputModalities: sql<string>`input_modalities`.as('input_modalities_raw'),
      outputModalities: sql<string>`output_modalities`.as('output_modalities_raw'),
      endpointTypes: sql<string>`endpoint_types`.as('endpoint_types_raw')
    })
    .from(userModelTable)
    .all()

  let updated = 0

  for (const row of rows) {
    const capConverted = convertEnumArray(row.capabilities, CAPABILITY_MAP)
    const inputConverted = convertEnumArray(row.inputModalities, MODALITY_MAP)
    const outputConverted = convertEnumArray(row.outputModalities, MODALITY_MAP)
    const endpointConverted = convertEnumArray(row.endpointTypes, ENDPOINT_TYPE_MAP)

    if (!capConverted && !inputConverted && !outputConverted && !endpointConverted) {
      continue
    }

    const updates: Record<string, unknown> = {}
    if (capConverted) updates.capabilities = capConverted
    if (inputConverted) updates.inputModalities = inputConverted
    if (outputConverted) updates.outputModalities = outputConverted
    if (endpointConverted) updates.endpointTypes = endpointConverted

    await db
      .update(userModelTable)
      .set(updates)
      .where(sql`${userModelTable.providerId} = ${row.providerId} AND ${userModelTable.modelId} = ${row.modelId}`)

    updated++
  }

  if (updated > 0) {
    logger.info('Migrated string enum values to numbers', { rowsUpdated: updated })
  }

  return updated
}
