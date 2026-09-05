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
import { Document, isAlias, isMap, isScalar, isSeq, parseDocument, visit, type YAMLError } from 'yaml'

export type DeepSeekHarnessMode = 'direct' | 'gateway'
export type DeepSeekHarnessProtocol = 'anthropic-messages' | 'openai-responses' | 'openai-completions'

export interface DeepSeekHarnessProjection {
  route: string
  credentialRef: string
  credentialValue: string
  displayName: string
  protocol: DeepSeekHarnessProtocol
  baseUrl: string
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

interface LockOwner {
  version: 1
  pid: number
  token: string
}

const SETTINGS_FILE = 'settings.yaml'
const CREDENTIALS_FILE = '.credentials.yaml'
const FILE_MODE = 0o600
const LOCK_TIMEOUT_MS = 2000
const LOCK_INITIAL_DELAY_MS = 20
const LOCK_MAX_DELAY_MS = 200

const MANAGED_CREDENTIAL_REF_RE = /^CHERRY_STUDIO_CODEMATE_(?:[A-F0-9]{12}|GATEWAY)_API_KEY$/i

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

function parseLockOwner(content: string): LockOwner | undefined {
  try {
    const owner = JSON.parse(content) as Partial<LockOwner>
    if (
      owner.version === 1 &&
      Number.isSafeInteger(owner.pid) &&
      Number(owner.pid) > 0 &&
      typeof owner.token === 'string' &&
      owner.token.length > 0
    ) {
      return owner as LockOwner
    }
  } catch {
    // Locks from DSH or older Cherry versions have no ownership metadata.
  }
  return undefined
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function reclaimOrphanedLock(lockPath: string): Promise<boolean> {
  let observed: string
  try {
    observed = await fs.readFile(lockPath, 'utf8')
  } catch (error) {
    if (isMissing(error)) return true
    throw error
  }

  const owner = parseLockOwner(observed)
  if (!owner || isProcessAlive(owner.pid)) return false

  try {
    if ((await fs.readFile(lockPath, 'utf8')) !== observed) return false
    await fs.unlink(lockPath)
    return true
  } catch (error) {
    if (isMissing(error)) return true
    throw error
  }
}

async function createLock(lockPath: string): Promise<HeldLock> {
  const handle = await fs.open(lockPath, 'wx', FILE_MODE)
  try {
    const owner: LockOwner = { version: 1, pid: process.pid, token: crypto.randomUUID() }
    await handle.writeFile(JSON.stringify(owner), 'utf8')
    return { path: lockPath, handle }
  } catch (error) {
    await handle.close().catch(() => {})
    await fs.unlink(lockPath).catch(() => {})
    throw error
  }
}

async function acquireLock(filePath: string): Promise<HeldLock> {
  const lockPath = `${filePath}.lock`
  const startedAt = Date.now()
  let backoff = LOCK_INITIAL_DELAY_MS

  while (true) {
    try {
      return await createLock(lockPath)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      if (await reclaimOrphanedLock(lockPath)) continue
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

function yamlStringKey(key: unknown): string | undefined {
  const value = isScalar(key) ? key.value : key
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function prependComments(target: { commentBefore?: string | null }, comments: Array<string | null | undefined>): void {
  const combined = [...comments, target.commentBefore].filter((comment): comment is string => Boolean(comment))
  if (combined.length > 0) target.commentBefore = combined.join('\n')
}

/**
 * DSH has always consumed provider models as a sequence, but pre-release
 * integrations could leave a map keyed by model id in the shared settings
 * file. One invalid sibling route makes DSH reject the entire llm-pi-ai
 * section, including Cherry's managed route. Convert only maps whose meaning
 * can be preserved exactly; fail loudly instead of deleting or guessing at
 * ambiguous user-owned data.
 */
function migrateLegacyProviderModels(document: Document): void {
  const providers = document.getIn(['llm-pi-ai', 'providers'], true)
  if (!isMap(providers)) return

  const providerModelAliases = new Set<unknown>()
  const providerModelValueAliases = new Set<unknown>()
  for (const providerPair of providers.items) {
    if (!isMap(providerPair.value)) continue
    const models = providerPair.value.get('models', true)
    if (isAlias(models)) providerModelAliases.add(models)
    if (isMap(models)) {
      for (const modelPair of models.items) {
        if (isAlias(modelPair.value)) providerModelValueAliases.add(modelPair.value)
      }
    }
  }

  for (const providerPair of providers.items) {
    if (!isMap(providerPair.value)) continue
    const models = providerPair.value.get('models', true)
    const route = yamlStringKey(providerPair.key)
    const routeLabel = route ?? '<invalid route>'
    if (models == null || isSeq(models)) continue
    if (isAlias(models)) {
      const resolvedModels = models.resolve(document)
      if (isSeq(resolvedModels)) continue
      if (isMap(resolvedModels)) {
        throw new Error(
          `DeepSeek Harness route ${routeLabel} models aliases a legacy map that cannot be safely migrated in place`
        )
      }
    }
    if (!isMap(models)) {
      throw new Error(`DeepSeek Harness route ${routeLabel} has a non-list models field`)
    }
    if (!route) {
      throw new Error('DeepSeek Harness provider route with legacy models must have a non-empty string key')
    }
    if (models.anchor) {
      let hasExternalAlias = false
      visit(document, {
        Alias(_key, alias) {
          if (alias.source === models.anchor && !providerModelAliases.has(alias)) hasExternalAlias = true
        }
      })
      if (hasExternalAlias) {
        throw new Error(
          `DeepSeek Harness route ${route} legacy models anchor ${models.anchor} is referenced outside provider models`
        )
      }
    }

    const migratedModels = document.createNode<unknown[]>([])
    if (!isSeq(migratedModels)) throw new Error('Failed to create DeepSeek Harness models list')
    migratedModels.commentBefore = models.commentBefore
    migratedModels.comment = models.comment
    migratedModels.spaceBefore = models.spaceBefore
    migratedModels.anchor = models.anchor

    for (const modelPair of models.items) {
      const modelId = yamlStringKey(modelPair.key)
      if (!modelId) {
        throw new Error(`DeepSeek Harness route ${route} has a legacy model with an invalid id key`)
      }
      const sourceModel = modelPair.value
      let resolvedModel = sourceModel
      if (isAlias(sourceModel)) {
        resolvedModel = sourceModel.resolve(document)
        if (!isMap(resolvedModel)) {
          throw new Error(`DeepSeek Harness route ${route} legacy model ${modelId} must be a mapping`)
        }
      }
      if (!isMap(resolvedModel)) {
        throw new Error(`DeepSeek Harness route ${route} legacy model ${modelId} must be a mapping`)
      }
      if (resolvedModel.anchor) {
        let hasExternalAlias = false
        visit(document, {
          Alias(_key, alias) {
            if (alias.source === resolvedModel.anchor && !providerModelValueAliases.has(alias)) hasExternalAlias = true
          }
        })
        if (hasExternalAlias) {
          throw new Error(
            `DeepSeek Harness route ${route} legacy model ${modelId} anchor ${resolvedModel.anchor} is referenced outside provider models`
          )
        }
      }
      // Always edit a detached YAML node. Individual legacy models may be anchored and referenced
      // elsewhere in the document; mutating the provider-owned node in place would silently add the
      // synthesized id to those external aliases. YAMLMap.clone preserves comments, tags, and scalar
      // styles that a toJS()/createNode() round trip would discard.
      const model = resolvedModel.clone(document.schema)
      if (!isMap(model)) throw new Error('Failed to clone DeepSeek Harness legacy model mapping')
      model.anchor = undefined

      const declaredIdNode = model.get('id', true)
      const resolvedIdNode = isAlias(declaredIdNode) ? declaredIdNode.resolve(document) : declaredIdNode
      const declaredId = isScalar(resolvedIdNode) ? resolvedIdNode.value : resolvedIdNode
      if (declaredIdNode == null) {
        model.set('id', modelId)
      } else if (declaredId !== modelId) {
        const declaredIdLabel = typeof declaredId === 'string' ? JSON.stringify(declaredId) : `<${typeof declaredId}>`
        throw new Error(
          `DeepSeek Harness route ${route} legacy model ${modelId} declares conflicting id ${declaredIdLabel}`
        )
      }

      if (isScalar(modelPair.key)) {
        const aliasComments = isAlias(sourceModel) ? [sourceModel.commentBefore, sourceModel.comment] : []
        prependComments(model, [modelPair.key.commentBefore, modelPair.key.comment, ...aliasComments])
      }
      migratedModels.add(model)
    }

    providerPair.value.set('models', migratedModels)
  }
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

  migrateLegacyProviderModels(document)

  document.setIn([...routePath, 'apiKeyEnv'], projection.credentialRef)
  document.setIn([...routePath, 'displayName'], projection.displayName)
  document.setIn([...routePath, 'api'], projection.protocol)
  document.setIn([...routePath, 'baseURL'], projection.baseUrl)
  document.deleteIn([...routePath, 'headers'])
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
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(credentialRef)) {
    throw new Error(`DeepSeek Harness credential reference ${JSON.stringify(credentialRef)} is invalid`)
  }
  // DSH 0.1.1 nests entries under `version: 1` + `refs:` and rejects unknown
  // top-level keys, including the one Cherry used to write there. Any other
  // document stays flat: pre-0.1.1 builds read it, and 0.1.1 migrates it itself.
  if (document.get('version') === 1) {
    if (document.getIn(['refs']) == null) document.setIn(['refs'], document.createNode({}))
    // Heal files polluted by older Cherry builds that wrote managed keys at
    // top-level: DSH 0.1.1 rejects any unknown top-level key, so every stale
    // CHERRY_STUDIO_CODEMATE_*_API_KEY entry must be removed, not just the
    // one for the current provider.
    if (isMap(document.contents)) {
      for (const pair of [...document.contents.items]) {
        const rawKey = (pair.key as { value?: unknown })?.value
        const key = typeof rawKey === 'string' ? rawKey : String(pair.key)
        if (MANAGED_CREDENTIAL_REF_RE.test(key)) document.delete(key)
      }
    }
    document.setIn(['refs', credentialRef], credentialValue)
  } else {
    document.setIn([credentialRef], credentialValue)
  }
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
  const endpoint = declaredModelEndpoints
    ? declaredModelEndpoints.find(hasBaseUrl)
    : isSupported(provider.defaultChatEndpoint) && hasBaseUrl(provider.defaultChatEndpoint)
      ? provider.defaultChatEndpoint
      : DIRECT_ENDPOINTS.find(hasBaseUrl)

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
