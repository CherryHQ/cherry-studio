import type { CreateAssistantDto } from '@shared/data/api/schemas/assistants'
import { type Assistant, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

export interface AssistantTransferTag {
  name: string
  color: string | null
}

export interface ImportedAssistantDraft {
  dto: CreateAssistantDto
  tags: AssistantTransferTag[]
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
  regularPhrases: []
  type: 'agent'
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

  // `modelId` is intentionally omitted — backend fills it from
  // `chat.default_model_id` preference. See AssistantService.resolveCreateModelId.
  return {
    dto: {
      name,
      prompt,
      emoji: readString(record.emoji, '🤖'),
      description: readString(record.description),
      settings: DEFAULT_ASSISTANT_SETTINGS
    },
    tags: readStringArray(record.group).map((tagName) => ({
      name: tagName,
      color: null
    }))
  }
}

function buildExportRecord(assistant: Assistant): AssistantExportRecord {
  return {
    name: assistant.name,
    emoji: assistant.emoji,
    group: assistant.tags.map((tag) => tag.name),
    prompt: assistant.prompt,
    description: assistant.description,
    regularPhrases: [],
    type: 'agent'
  }
}

export function serializeAssistantForExport(assistant: Assistant): string {
  return JSON.stringify([buildExportRecord(assistant)], null, 2)
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
