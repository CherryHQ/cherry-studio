import {
  type ImportAssistantDto,
  type ImportAssistantPhraseDto,
  ImportAssistantPhraseSchema
} from '@shared/data/api/schemas/assistants'
import { type Assistant, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Assistant import file, clipboard and URL JSON fields are untyped; copy only strings and retain the legacy optional-field defaults.
function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Imported group metadata may contain mixed JSON values; retain only actual string group names before choosing the first group.
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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Imported phrase entries are untyped JSON; validate the record and parse title/content with ImportAssistantPhraseSchema before creating a draft.
function normalizePhrase(value: unknown): ImportAssistantPhraseDto {
  if (!isRecord(value)) throw new AssistantTransferError('invalid_format')

  const title = truncateTitle(readString(value.title).trim() || 'Untitled')
  const parsed = ImportAssistantPhraseSchema.safeParse({ title, content: value.content })
  if (!parsed.success) throw new AssistantTransferError('invalid_format')
  return parsed.data
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Imported regularPhrases may be absent or malformed; require an array and validate every phrase before any assistant is imported.
function readRegularPhrases(value: unknown): ImportAssistantPhraseDto[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new AssistantTransferError('invalid_format')
  return value.map(normalizePhrase)
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- File, clipboard and URL imports reach this record decoder before mutation; validate required name/prompt and normalize optional legacy fields.
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
      settings: DEFAULT_ASSISTANT_SETTINGS,
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

export function serializeAssistantsForExport(
  entries: readonly { assistant: Assistant; prompts: readonly Prompt[]; groupName?: string }[]
): string {
  if (entries.length === 0) throw new AssistantTransferError('invalid_format')
  return JSON.stringify(
    entries.map(({ assistant, prompts, groupName }) => buildExportRecord(assistant, prompts, groupName)),
    null,
    2
  )
}

export function parseAssistantImportContent(content: string): ImportedAssistantDraft[] {
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    throw new AssistantTransferError('invalid_format')
  }

  const records: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
  if (records.length === 0) {
    throw new AssistantTransferError('invalid_format')
  }

  return records.map((record) => normalizeRecord(record))
}
