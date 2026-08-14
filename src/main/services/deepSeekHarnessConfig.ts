import crypto from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import fs from 'node:fs/promises'
import path from 'node:path'

import { atomicWriteFile } from '@main/utils/file'
import { ENDPOINT_TYPE, type EndpointType, MODALITY, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { DeepSeekHarnessAgentPreset } from '@shared/types/codeCli'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { formatApiHost, withoutTrailingApiVersion } from '@shared/utils/api'
import { Document, isMap, isSeq, parseDocument, type YAMLError } from 'yaml'

export type DeepSeekHarnessMode = 'direct' | 'gateway'
export type DeepSeekHarnessProtocol = 'anthropic-messages' | 'openai-responses' | 'openai-completions'

export interface DeepSeekHarnessProjection {
  route: string
  credentialRef: string
  credentialValue: string
  displayName: string
  protocol: DeepSeekHarnessProtocol
  baseUrl: string
  headers?: Record<string, string>
  model: Model
  modelId: string
  agentPreset: DeepSeekHarnessAgentPreset
}

interface FileSnapshot {
  path: AbsoluteFilePath
  content?: string
}

export interface DeepSeekHarnessConfigReceipt {
  credentials: FileSnapshot & { written: string }
  settings: FileSnapshot & { written: string }
}

interface HeldLock {
  path: string
  handle: FileHandle
}

const SETTINGS_FILE = 'settings.yaml'
const CREDENTIALS_FILE = '.credentials.yaml'
const FILE_MODE = 0o600
const LOCK_TIMEOUT_MS = 2000
const LOCK_INITIAL_DELAY_MS = 20
const LOCK_MAX_DELAY_MS = 200

const DIRECT_ENDPOINTS = [
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  ENDPOINT_TYPE.OPENAI_RESPONSES,
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
] as const

const PROTOCOL_BY_ENDPOINT: Record<(typeof DIRECT_ENDPOINTS)[number], DeepSeekHarnessProtocol> = {
  [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: 'anthropic-messages',
  [ENDPOINT_TYPE.OPENAI_RESPONSES]: 'openai-responses',
  [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'openai-completions'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EEXIST'
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

async function acquireLock(filePath: string): Promise<HeldLock> {
  const lockPath = `${filePath}.lock`
  const startedAt = Date.now()
  let backoff = LOCK_INITIAL_DELAY_MS

  while (true) {
    try {
      return { path: lockPath, handle: await fs.open(lockPath, 'wx', FILE_MODE) }
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      const elapsed = Date.now() - startedAt
      if (elapsed >= LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for DeepSeek Harness config lock: ${path.basename(lockPath)}`)
      }
      await delay(Math.min(backoff, LOCK_TIMEOUT_MS - elapsed))
      backoff = Math.min(backoff * 2, LOCK_MAX_DELAY_MS)
    }
  }
}

async function acquireConfigLocks(credentialsPath: string, settingsPath: string): Promise<HeldLock[]> {
  const locks: HeldLock[] = []
  try {
    locks.push(await acquireLock(credentialsPath))
    locks.push(await acquireLock(settingsPath))
    return locks
  } catch (error) {
    await releaseLocks(locks)
    throw error
  }
}

async function releaseLocks(locks: HeldLock[]): Promise<void> {
  let releaseError: unknown
  for (const lock of [...locks].reverse()) {
    try {
      await lock.handle.close()
      await fs.unlink(lock.path)
    } catch (error) {
      releaseError ??= error
    }
  }
  if (releaseError) throw releaseError
}

async function readSnapshot(filePath: AbsoluteFilePath): Promise<FileSnapshot> {
  try {
    return { path: filePath, content: await fs.readFile(filePath, 'utf8') }
  } catch (error) {
    if (isMissing(error)) return { path: filePath }
    throw error
  }
}

function parseMappingDocument(snapshot: FileSnapshot): Document {
  const document = snapshot.content === undefined ? new Document({}) : parseDocument(snapshot.content)
  if (document.errors.length > 0) {
    throw new Error(
      `Invalid DeepSeek Harness YAML in ${path.basename(snapshot.path)}: ${describeYamlError(document.errors[0])}`
    )
  }
  if (document.contents === null) document.contents = document.createNode({})
  if (!isMap(document.contents)) {
    throw new Error(`DeepSeek Harness ${path.basename(snapshot.path)} must contain a YAML mapping`)
  }
  return document
}

function describeYamlError(error: YAMLError): string {
  const at = error.linePos?.[0]
  const location = at ? ` at line ${at.line}, column ${at.col}` : ''
  return `${error.code}${location}`
}

function setOptional(document: Document, configPath: (string | number)[], value: unknown): void {
  if (value === undefined) document.deleteIn(configPath)
  else document.setIn(configPath, value)
}

function projectModelInput(model: Model): Array<'text' | 'image'> {
  const declared = model.inputModalities?.filter(
    (modality): modality is 'text' | 'image' => modality === MODALITY.TEXT || modality === MODALITY.IMAGE
  )
  if (declared?.length) return declared

  const input: Array<'text' | 'image'> = ['text']
  if (model.capabilities.includes(MODEL_CAPABILITY.IMAGE_RECOGNITION)) input.push('image')
  return input
}

function projectReasoningEfforts(model: Model): false | Record<string, string | null> | undefined {
  const selectable = model.reasoning?.selectableEfforts ?? []
  const efforts: Record<string, string | null> = {}
  for (const effort of selectable) {
    if (effort === 'none') efforts.off = null
    else if (effort !== 'auto') efforts[effort] = effort
  }
  const thinkingLevels = Object.keys(efforts).filter((effort) => effort !== 'off')
  if (thinkingLevels.length > 0) return efforts
  if (selectable.length > 0 && !selectable.includes('auto')) return false
  return undefined
}

function updateManagedModel(document: Document, projection: DeepSeekHarnessProjection): void {
  const modelsPath = ['llm-pi-ai', 'providers', projection.route, 'models']
  if (!document.hasIn(modelsPath)) document.setIn(modelsPath, document.createNode([]))
  const models = document.getIn(modelsPath, true)
  if (!isSeq(models)) throw new Error(`DeepSeek Harness route ${projection.route} has a non-list models field`)

  let model = models.items.find((item) => isMap(item) && item.get('id') === projection.modelId)
  if (!model) {
    model = document.createNode({ id: projection.modelId })
    models.add(model)
  }
  if (!isMap(model)) throw new Error(`DeepSeek Harness route ${projection.route} contains an invalid model entry`)

  model.set('id', projection.modelId)
  model.set('name', projection.model.name || projection.modelId)
  if (projection.model.contextWindow === undefined) model.delete('contextWindow')
  else model.set('contextWindow', projection.model.contextWindow)
  if (projection.model.maxOutputTokens === undefined) model.delete('maxTokens')
  else model.set('maxTokens', projection.model.maxOutputTokens)
  model.set('input', projectModelInput(projection.model))
  const reasoningEfforts = projectReasoningEfforts(projection.model)
  if (reasoningEfforts === undefined) model.delete('reasoningEfforts')
  else model.set('reasoningEfforts', reasoningEfforts)
}

function renderSettings(snapshot: FileSnapshot, projection: DeepSeekHarnessProjection): string {
  const document = parseMappingDocument(snapshot)
  const routePath = ['llm-pi-ai', 'providers', projection.route]
  if (document.hasIn(routePath)) {
    const credentialRef = document.getIn([...routePath, 'apiKeyEnv'])
    if (credentialRef !== projection.credentialRef) {
      throw new Error(`DeepSeek Harness route ${projection.route} is not owned by CodeMate`)
    }
  }

  document.setIn([...routePath, 'apiKeyEnv'], projection.credentialRef)
  document.setIn([...routePath, 'displayName'], projection.displayName)
  document.setIn([...routePath, 'api'], projection.protocol)
  document.setIn([...routePath, 'baseURL'], projection.baseUrl)
  setOptional(document, [...routePath, 'headers'], projection.headers)
  updateManagedModel(document, projection)
  document.setIn(['agent-default-model', 'provider'], projection.route)
  document.setIn(['agent-default-model', 'model'], projection.modelId)
  document.deleteIn(['agent-default-model', 'reasoningEffort'])
  if (projection.agentPreset !== 'inherit') {
    document.setIn(['agent-presets', 'default'], projection.agentPreset)
  }
  return document.toString()
}

function renderCredentials(snapshot: FileSnapshot, credentialRef: string, credentialValue: string): string {
  const document = parseMappingDocument(snapshot)
  const entries = document.toJS() as Record<string, unknown>
  for (const [key, value] of Object.entries(entries)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`DeepSeek Harness credential reference ${JSON.stringify(key)} is invalid`)
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`DeepSeek Harness credential ${JSON.stringify(key)} must be a non-empty string`)
    }
  }
  document.setIn([credentialRef], credentialValue)
  return document.toString()
}

async function restoreSnapshot(snapshot: FileSnapshot): Promise<void> {
  if (snapshot.content === undefined) {
    await fs.unlink(snapshot.path).catch((error) => {
      if (!isMissing(error)) throw error
    })
  } else {
    await atomicWriteFile(snapshot.path, snapshot.content, { mode: FILE_MODE })
  }
}

async function restoreSnapshots(settings: FileSnapshot, credentials: FileSnapshot): Promise<void> {
  const failures: unknown[] = []
  for (const snapshot of [settings, credentials]) {
    await restoreSnapshot(snapshot).catch((error) => failures.push(error))
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Failed to restore DeepSeek Harness config files')
}

function sameSnapshotContent(snapshot: FileSnapshot, expected: string): boolean {
  return snapshot.content === expected
}

export function resolveDeepSeekHarnessEndpoint(
  provider: Provider,
  model: Model
): { endpoint: EndpointType; protocol: DeepSeekHarnessProtocol; baseUrl: string } {
  const isSupported = (endpoint: EndpointType | undefined): endpoint is (typeof DIRECT_ENDPOINTS)[number] =>
    Boolean(endpoint && DIRECT_ENDPOINTS.includes(endpoint as (typeof DIRECT_ENDPOINTS)[number]))
  const hasBaseUrl = (endpoint: EndpointType): boolean => Boolean(provider.endpointConfigs?.[endpoint]?.baseUrl)
  const declaredModelEndpoints = model.endpointTypes?.length ? model.endpointTypes.filter(isSupported) : undefined
  let endpoint = declaredModelEndpoints
    ? declaredModelEndpoints.find(hasBaseUrl)
    : isSupported(provider.defaultChatEndpoint) && hasBaseUrl(provider.defaultChatEndpoint)
      ? provider.defaultChatEndpoint
      : DIRECT_ENDPOINTS.find(hasBaseUrl)

  if (
    endpoint === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS &&
    provider.apiFeatures.developerRole === false &&
    (model.capabilities.includes(MODEL_CAPABILITY.REASONING) || model.reasoning !== undefined) &&
    declaredModelEndpoints?.includes(ENDPOINT_TYPE.ANTHROPIC_MESSAGES) &&
    hasBaseUrl(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
  ) {
    endpoint = ENDPOINT_TYPE.ANTHROPIC_MESSAGES
  }

  if (!endpoint) throw new Error(`Provider ${provider.id} has no DeepSeek Harness compatible endpoint`)
  const rawBaseUrl = provider.endpointConfigs?.[endpoint]?.baseUrl
  if (!rawBaseUrl) throw new Error(`Provider ${provider.id} has no API host configured for ${endpoint}`)
  const baseUrl =
    endpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      ? withoutTrailingApiVersion(formatApiHost(rawBaseUrl, false))
      : formatApiHost(rawBaseUrl)
  return { endpoint, protocol: PROTOCOL_BY_ENDPOINT[endpoint], baseUrl }
}

export function createDeepSeekHarnessDirectIdentity(
  providerId: string,
  protocol: DeepSeekHarnessProtocol
): {
  route: string
  credentialRef: string
} {
  const hash = crypto.createHash('sha256').update(`${providerId}\0${protocol}`).digest('hex').slice(0, 12)
  return {
    route: `cherry-studio-codemate-${hash}`,
    credentialRef: `CHERRY_STUDIO_CODEMATE_${hash.toUpperCase()}_API_KEY`
  }
}

export async function writeDeepSeekHarnessConfig(
  configDir: AbsoluteFilePath,
  projection: DeepSeekHarnessProjection
): Promise<DeepSeekHarnessConfigReceipt> {
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 })
  const credentialsPath = AbsoluteFilePathSchema.parse(path.join(configDir, CREDENTIALS_FILE))
  const settingsPath = AbsoluteFilePathSchema.parse(path.join(configDir, SETTINGS_FILE))
  const locks = await acquireConfigLocks(credentialsPath, settingsPath)

  try {
    const credentials = await readSnapshot(credentialsPath)
    const settings = await readSnapshot(settingsPath)
    const writtenCredentials = renderCredentials(credentials, projection.credentialRef, projection.credentialValue)
    const writtenSettings = renderSettings(settings, projection)

    try {
      await atomicWriteFile(credentialsPath, writtenCredentials, { mode: FILE_MODE })
      await atomicWriteFile(settingsPath, writtenSettings, { mode: FILE_MODE })
    } catch (error) {
      try {
        await restoreSnapshots(settings, credentials)
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Failed to roll back DeepSeek Harness config transaction')
      }
      throw error
    }

    return {
      credentials: { ...credentials, written: writtenCredentials },
      settings: { ...settings, written: writtenSettings }
    }
  } finally {
    await releaseLocks(locks)
  }
}

export async function rollbackDeepSeekHarnessConfig(receipt: DeepSeekHarnessConfigReceipt): Promise<boolean> {
  const locks = await acquireConfigLocks(receipt.credentials.path, receipt.settings.path)
  try {
    const currentCredentials = await readSnapshot(receipt.credentials.path)
    const currentSettings = await readSnapshot(receipt.settings.path)
    if (
      !sameSnapshotContent(currentCredentials, receipt.credentials.written) ||
      !sameSnapshotContent(currentSettings, receipt.settings.written)
    ) {
      return false
    }
    await restoreSnapshots(receipt.settings, receipt.credentials)
    return true
  } finally {
    await releaseLocks(locks)
  }
}
