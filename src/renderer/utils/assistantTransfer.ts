import {
  type ImportAssistantDto,
  type ImportAssistantPhraseDto,
  ImportAssistantPhraseSchema
} from '@shared/data/api/schemas/assistants'
import { type Assistant, LEGACY_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { type Prompt, PROMPT_TITLE_MAX } from '@shared/data/types/prompt'

export interface ImportedAssistantDraft {
  dto: Omit<ImportAssistantDto, 'groupName'>
  groupName?: string
}

export class AssistantTransferError extends Error {
  constructor(public readonly code: 'invalid_format') {
    super(code)
    this.name = 'AssistantTransferError'
  }
}

interface AssistantExportRecord {
  name: string
  emoji: string
  group: string[]
  prompt: string
  description: string
  regularPhrases: AssistantExportPhrase[]
  type: 'agent'
}

interface AssistantExportPhrase {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
  order: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value.filter((item): item is string => typeof item === 'string')
}

function truncateTitle(value: string): string {
  let result = ''
  for (const character of value) {
    if (result.length + character.length > PROMPT_TITLE_MAX) break
    result += character
  }
  return result
}

function normalizePhrase(value: unknown): ImportAssistantPhraseDto {
  if (!isRecord(value)) throw new AssistantTransferError('invalid_format')

  const title = truncateTitle(readString(value.title).trim() || 'Untitled')
  const parsed = ImportAssistantPhraseSchema.safeParse({ title, content: value.content })
  if (!parsed.success) throw new AssistantTransferError('invalid_format')
  return parsed.data
}

function readRegularPhrases(value: unknown): ImportAssistantPhraseDto[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new AssistantTransferError('invalid_format')
  return value.map(normalizePhrase)
}

function normalizeRecord(record: unknown): ImportedAssistantDraft {
  if (!isRecord(record)) {
    throw new AssistantTransferError('invalid_format')
  }

  const name = readString(record.name)
  const prompt = readString(record.prompt)

  // Match the legacy import popup: both fields must exist and be truthy.
  if (!name || !prompt) {
    throw new AssistantTransferError('invalid_format')
  }

  const groupName = readStringArray(record.group)[0]

  // `modelId` is intentionally omitted — backend fills it from
  // `chat.default_model_id` preference. See AssistantService.resolveCreateModelId.
  return {
    dto: {
      name,
      prompt,
      emoji: readString(record.emoji) || '🤖',
      description: readString(record.description),
      settings: LEGACY_ASSISTANT_SETTINGS,
      regularPhrases: readRegularPhrases(record.regularPhrases)
    },
    groupName
  }
}

function buildExportRecord(
  assistant: Assistant,
  prompts: readonly Prompt[],
  groupName?: string
): AssistantExportRecord {
  return {
    name: assistant.name,
    emoji: assistant.emoji,
    group: groupName ? [groupName] : [],
    prompt: assistant.prompt,
    description: assistant.description,
    regularPhrases: prompts.map((prompt, order) => ({
      id: prompt.id,
      title: prompt.title,
      content: prompt.content,
      createdAt: Date.parse(prompt.createdAt),
      updatedAt: Date.parse(prompt.updatedAt),
      order
    })),
    type: 'agent'
  }
}

export function serializeAssistantForExport(
  assistant: Assistant,
  prompts: readonly Prompt[],
  groupName?: string
): string {
  return JSON.stringify([buildExportRecord(assistant, prompts, groupName)], null, 2)
}

export function parseAssistantImportContent(content: string): ImportedAssistantDraft[] {
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    throw new AssistantTransferError('invalid_format')
  }

  const records = Array.isArray(parsed) ? parsed : [parsed]
  if (records.length === 0) {
    throw new AssistantTransferError('invalid_format')
  }

  return records.map((record) => normalizeRecord(record))
}
