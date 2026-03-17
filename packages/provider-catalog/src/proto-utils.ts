/**
 * Utilities for converting between JSON string values and proto enum numbers.
 * Also provides helpers for loading/saving .pb files.
 */

import { readFileSync, writeFileSync } from 'node:fs'

import type { DescMessage, MessageShape } from '@bufbuild/protobuf'
import { fromBinary, toBinary } from '@bufbuild/protobuf'

import { Currency, EndpointType, Modality, ModelCapability, ReasoningEffort } from './gen/v1/common_pb'

// ═══════════════════════════════════════════════════════════════════════════════
// Enum string → proto number mappings
// ═══════════════════════════════════════════════════════════════════════════════

const ENDPOINT_TYPE_MAP: Record<string, EndpointType> = {
  chat_completions: EndpointType.OPENAI_CHAT_COMPLETIONS,
  text_completions: EndpointType.OPENAI_TEXT_COMPLETIONS,
  messages: EndpointType.ANTHROPIC_MESSAGES,
  responses: EndpointType.OPENAI_RESPONSES,
  generate_content: EndpointType.GOOGLE_GENERATE_CONTENT,
  ollama_chat: EndpointType.OLLAMA_CHAT,
  ollama_generate: EndpointType.OLLAMA_GENERATE,
  embeddings: EndpointType.OPENAI_EMBEDDINGS,
  rerank: EndpointType.JINA_RERANK,
  image_generation: EndpointType.OPENAI_IMAGE_GENERATION,
  image_edit: EndpointType.OPENAI_IMAGE_EDIT,
  audio_transcription: EndpointType.OPENAI_AUDIO_TRANSCRIPTION,
  audio_translation: EndpointType.OPENAI_AUDIO_TRANSLATION,
  text_to_speech: EndpointType.OPENAI_TEXT_TO_SPEECH,
  video_generation: EndpointType.OPENAI_VIDEO_GENERATION
}

const CAPABILITY_MAP: Record<string, ModelCapability> = {
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

const MODALITY_MAP: Record<string, Modality> = {
  TEXT: Modality.TEXT,
  IMAGE: Modality.IMAGE,
  AUDIO: Modality.AUDIO,
  VIDEO: Modality.VIDEO,
  VECTOR: Modality.VECTOR
}

const CURRENCY_MAP: Record<string, Currency> = {
  USD: Currency.USD,
  CNY: Currency.CNY
}

const REASONING_EFFORT_MAP: Record<string, ReasoningEffort> = {
  none: ReasoningEffort.NONE,
  minimal: ReasoningEffort.MINIMAL,
  low: ReasoningEffort.LOW,
  medium: ReasoningEffort.MEDIUM,
  high: ReasoningEffort.HIGH,
  max: ReasoningEffort.MAX,
  auto: ReasoningEffort.AUTO
}

export function toEndpointType(s: string): EndpointType {
  return ENDPOINT_TYPE_MAP[s] ?? EndpointType.UNSPECIFIED
}

export function toCapability(s: string): ModelCapability {
  return CAPABILITY_MAP[s] ?? ModelCapability.UNSPECIFIED
}

export function toModality(s: string): Modality {
  return MODALITY_MAP[s] ?? Modality.UNSPECIFIED
}

export function toCurrency(s: string | undefined): Currency {
  if (!s) return Currency.USD
  return CURRENCY_MAP[s] ?? Currency.USD
}

export function toReasoningEffort(s: string): ReasoningEffort {
  return REASONING_EFFORT_MAP[s] ?? ReasoningEffort.UNSPECIFIED
}

// ═══════════════════════════════════════════════════════════════════════════════
// Reverse mappings: proto number → JSON string
// ═══════════════════════════════════════════════════════════════════════════════

const ENDPOINT_TYPE_REVERSE = Object.fromEntries(Object.entries(ENDPOINT_TYPE_MAP).map(([k, v]) => [v, k])) as Record<
  EndpointType,
  string
>

const CAPABILITY_REVERSE = Object.fromEntries(Object.entries(CAPABILITY_MAP).map(([k, v]) => [v, k])) as Record<
  ModelCapability,
  string
>

const MODALITY_REVERSE = Object.fromEntries(Object.entries(MODALITY_MAP).map(([k, v]) => [v, k])) as Record<
  Modality,
  string
>

const REASONING_EFFORT_REVERSE = Object.fromEntries(
  Object.entries(REASONING_EFFORT_MAP).map(([k, v]) => [v, k])
) as Record<ReasoningEffort, string>

export function fromEndpointType(n: EndpointType): string {
  return ENDPOINT_TYPE_REVERSE[n] ?? ''
}

export function fromCapability(n: ModelCapability): string {
  return CAPABILITY_REVERSE[n] ?? ''
}

export function fromModality(n: Modality): string {
  return MODALITY_REVERSE[n] ?? ''
}

export function fromCurrency(n: Currency): string {
  if (n === Currency.CNY) return 'CNY'
  return 'USD'
}

export function fromReasoningEffort(n: ReasoningEffort): string {
  return REASONING_EFFORT_REVERSE[n] ?? ''
}

// ═══════════════════════════════════════════════════════════════════════════════
// File I/O helpers
// ═══════════════════════════════════════════════════════════════════════════════

export function loadBinary<T extends DescMessage>(schema: T, path: string): MessageShape<T> {
  const bytes = readFileSync(path)
  return fromBinary(schema, new Uint8Array(bytes))
}

export function saveBinary<T extends DescMessage>(schema: T, message: MessageShape<T>, path: string): void {
  const bytes = toBinary(schema, message)
  writeFileSync(path, bytes)
}
