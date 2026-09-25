import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { dialog } from 'electron'

import { application } from '@application'
import type {
  LiterConfigApplyResult,
  LiterConfigEdit,
  LiterConfigExportResult,
  LiterConfigPreview,
  LiterConfigSnapshot,
  LiterConfigSource,
  LiterConfigSourceSelection,
  LiterConfigValidation
} from '@shared/types/literConfig'

import {
  integrationDirectory,
  readIntegrationConfig,
  readLiterConnectionCredential,
  readSecrets
} from './integrationConfig'
import { runIntegrationProcess } from './integrationProcess'
import { serviceDirectory } from './managedServices'

const EMPTY_CONFIG =
  '[server]\nhost = "0.0.0.0"\nport = 4000\n\n[general]\nmaster_key = "${LITER_LLM_MASTER_KEY}"\n\n[security]\noutbound_policy = "deny_private"\n'
type TomlEditor = typeof import('@rainbowatcher/toml-edit-js')

let tomlEditorReady: Promise<TomlEditor> | undefined

function revisionOf(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}

export async function selectLocalLiterConfig(): Promise<LiterConfigSourceSelection> {
  const selected = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'TOML configuration', extensions: ['toml'] }]
  })
  if (selected.canceled || !selected.filePaths[0]) return { cancelled: true }
  return { ownership: 'local', path: await fs.realpath(selected.filePaths[0]) }
}

async function ensureTomlEditor(): Promise<TomlEditor> {
  tomlEditorReady ??= Promise.all([
    fs.readFile(application.getPath('feature.prometheus.toml_editor_wasm')),
    import('@rainbowatcher/toml-edit-js')
  ]).then(([bytes, editor]) => {
    editor.initSync(new Uint8Array(bytes))
    return editor
  })
  return tomlEditorReady
}

async function resolveSource(source: LiterConfigSource): Promise<{ path: string; content: string; exists: boolean }> {
  if (source.ownership === 'managed') {
    const filename = path.join(serviceDirectory(), 'liter-llm-proxy.toml')
    try {
      return { path: filename, content: await fs.readFile(filename, 'utf8'), exists: true }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { path: filename, content: EMPTY_CONFIG, exists: false }
      throw error
    }
  }

  if (!path.isAbsolute(source.path)) throw new Error('prometheus.error.literConfigPath')
  const filename = await fs.realpath(source.path)
  const stat = await fs.stat(filename)
  if (!stat.isFile()) throw new Error('prometheus.error.literConfigPath')
  return { path: filename, content: await fs.readFile(filename, 'utf8'), exists: true }
}

async function checker(): Promise<{ available: boolean; path?: string; version?: string }> {
  const override = process.env.THE_BOSS_LITER_LLM_PATH?.trim()
  if (override) return { available: true, path: override }
  const snapshot = (await application.get('BinaryManager').getToolSnapshots(['liter-llm']))['liter-llm']
  if (snapshot.availability.source === 'none') return { available: false }
  return {
    available: true,
    path: snapshot.availability.path,
    ...('version' in snapshot.availability && snapshot.availability.version
      ? { version: snapshot.availability.version }
      : {})
  }
}

async function validate(
  content: string
): Promise<{ checker: Awaited<ReturnType<typeof checker>>; result: LiterConfigValidation }> {
  const native = await checker()
  if (!native.path) {
    return {
      checker: native,
      result: { valid: false, code: 'binary_unavailable', message: 'prometheus.error.literCheckerUnavailable' }
    }
  }
  const directory = path.join(integrationDirectory(), 'config-check')
  const filename = path.join(directory, `${randomUUID()}.toml`)
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  await fs.writeFile(filename, content, { mode: 0o600 })
  try {
    const secrets = await readSecrets()
    const output = await runIntegrationProcess(native.path, ['config-check', '--config', filename], {
      env: {
        ...(secrets.literKey ? { LITER_LLM_MASTER_KEY: secrets.literKey } : {}),
        ...(secrets.criticKey ? { CRITIC_API_KEY: secrets.criticKey } : {}),
        ...(secrets.judgeKey ? { JUDGE_API_KEY: secrets.judgeKey } : {})
      },
      secrets: Object.values(secrets).filter((value): value is string => Boolean(value))
    })
    const line = output
      .trim()
      .split(/\r?\n/)
      .findLast((candidate) => candidate.trim().startsWith('{'))
    if (!line) throw new Error('liter-llm config checker returned no structured result')
    const parsed = JSON.parse(line) as { valid?: boolean; code?: string; message?: string }
    return parsed.valid
      ? { checker: native, result: { valid: true } }
      : {
          checker: native,
          result: {
            valid: false,
            code: parsed.code === 'read_failed' ? 'read_failed' : 'invalid_config',
            message: parsed.message ?? 'prometheus.error.literConfigInvalid'
          }
        }
  } finally {
    await fs.rm(filename, { force: true })
  }
}

async function candidate(source: LiterConfigSource, expectedRevision: string, edits: LiterConfigEdit[]) {
  const current = await resolveSource(source)
  const currentRevision = revisionOf(current.content)
  if (currentRevision !== expectedRevision) {
    return {
      current,
      currentRevision,
      conflict: { expectedRevision, currentRevision }
    }
  }
  const { edit: editToml, parse: parseToml } = await ensureTomlEditor()
  try {
    parseToml(current.content)
    const content = edits.reduce((document, change) => editToml(document, change.path, change.value), current.content)
    return { current, currentRevision, content }
  } catch {
    throw new Error('prometheus.error.literConfigInvalid')
  }
}

type LiterModelDocument = {
  name: string
  provider_model: string
  api_key?: string
  base_url?: string
  timeout_secs: number
}

function selectedGatewayId(endpoint: string): string {
  return `gateway-${createHash('sha256').update(new URL(endpoint).href).digest('hex').slice(0, 16)}`
}

async function savedGatewayEdits(): Promise<LiterConfigEdit[]> {
  const config = readIntegrationConfig()
  const gatewayConnectionId = selectedGatewayId(config.services.liter.endpoint)
  const connections = new Map(
    config.services.literConnections
      .filter((connection) => connection.enabled)
      .map((connection) => [connection.providerConnectionId, connection])
  )
  const models: LiterModelDocument[] = []
  for (const alias of config.services.literAliases) {
    if (!alias.enabled || alias.gatewayConnectionId !== gatewayConnectionId) continue
    const connection = connections.get(alias.target.providerConnectionId)
    if (!connection) continue
    const credential = await readLiterConnectionCredential(connection.providerConnectionId)
    models.push({
      name: alias.alias,
      provider_model: `${alias.target.providerId}/${alias.target.modelId}`,
      ...(credential ? { api_key: credential } : {}),
      ...(connection.baseUrl ? { base_url: connection.baseUrl } : {}),
      timeout_secs: Math.max(1, Math.ceil(connection.timeoutMs / 1000))
    })
  }
  return [{ path: 'models', value: models }]
}

export async function readLiterConfig(source: LiterConfigSource): Promise<LiterConfigSnapshot> {
  const current = await resolveSource(source)
  const checked = await validate(current.content)
  return {
    source,
    path: current.path,
    exists: current.exists,
    revision: revisionOf(current.content),
    checker: checked.checker,
    validation: checked.result
  }
}

export async function previewLiterConfig(
  source: LiterConfigSource,
  expectedRevision: string,
  edits: LiterConfigEdit[]
): Promise<LiterConfigPreview> {
  const prepared = await candidate(source, expectedRevision, edits)
  if (!('content' in prepared)) {
    return {
      source,
      baseRevision: prepared.currentRevision,
      nextRevision: prepared.currentRevision,
      changedPaths: [],
      validation: { valid: false, code: 'invalid_config', message: 'prometheus.error.literConfigConflict' },
      conflict: prepared.conflict
    }
  }
  return {
    source,
    baseRevision: prepared.currentRevision,
    nextRevision: revisionOf(prepared.content),
    changedPaths: [...new Set(edits.map((change) => change.path))],
    validation: (await validate(prepared.content)).result
  }
}

/** Builds the provider model table in the main process so credentials never cross renderer IPC. */
export async function previewSavedLiterConfig(
  source: LiterConfigSource,
  expectedRevision: string
): Promise<LiterConfigPreview> {
  return previewLiterConfig(source, expectedRevision, await savedGatewayEdits())
}

async function writeCandidate(
  filename: string,
  content: string,
  source: LiterConfigSource
): Promise<string | undefined> {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
  const backupPath =
    source.ownership === 'managed'
      ? `${filename}.last-good`
      : `${filename}.the-boss-${new Date().toISOString().replaceAll(':', '-')}.bak`
  try {
    await fs.copyFile(filename, backupPath)
    await fs.chmod(backupPath, 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const staged = `${filename}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(staged, content, { mode: 0o600 })
    await fs.rename(staged, filename)
  } finally {
    await fs.rm(staged, { force: true })
  }
  return (await fs.stat(backupPath).catch(() => undefined)) ? backupPath : undefined
}

export async function applyLiterConfig(
  source: LiterConfigSource,
  expectedRevision: string,
  edits: LiterConfigEdit[]
): Promise<LiterConfigApplyResult> {
  const prepared = await candidate(source, expectedRevision, edits)
  if (!('content' in prepared)) {
    return {
      source,
      baseRevision: prepared.currentRevision,
      nextRevision: prepared.currentRevision,
      changedPaths: [],
      validation: { valid: false, code: 'invalid_config', message: 'prometheus.error.literConfigConflict' },
      conflict: prepared.conflict,
      state: 'conflict'
    }
  }
  const validation = (await validate(prepared.content)).result
  const preview = {
    source,
    baseRevision: prepared.currentRevision,
    nextRevision: revisionOf(prepared.content),
    changedPaths: [...new Set(edits.map((change) => change.path))],
    validation
  }
  if (!validation.valid) return { ...preview, state: 'validation-failed' }
  const backupPath = await writeCandidate(prepared.current.path, prepared.content, source)
  return {
    ...preview,
    state: 'restart-required',
    ...(backupPath ? { backupPath } : {}),
    appliedPath: prepared.current.path
  }
}

/** Applies saved typed gateway records and protected provider credentials to the selected config. */
export async function applySavedLiterConfig(
  source: LiterConfigSource,
  expectedRevision: string
): Promise<LiterConfigApplyResult> {
  return applyLiterConfig(source, expectedRevision, await savedGatewayEdits())
}

export async function exportLiterConfig(
  source: LiterConfigSource,
  expectedRevision: string,
  edits: LiterConfigEdit[],
  remoteEndpoint?: string
): Promise<LiterConfigExportResult> {
  const prepared = await candidate(source, expectedRevision, edits)
  if (!('content' in prepared)) {
    return {
      cancelled: false,
      remoteEndpoint,
      state: 'conflict',
      conflict: prepared.conflict
    }
  }
  const validation = (await validate(prepared.content)).result
  if (!validation.valid) return { cancelled: false, remoteEndpoint, validation }
  const selected = await dialog.showSaveDialog({
    defaultPath: 'liter-llm-proxy.toml',
    filters: [{ name: 'TOML configuration', extensions: ['toml'] }]
  })
  if (selected.canceled || !selected.filePath) return { cancelled: true, remoteEndpoint }
  const staged = `${selected.filePath}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(staged, prepared.content, { mode: 0o600 })
    await fs.rename(staged, selected.filePath)
  } finally {
    await fs.rm(staged, { force: true })
  }
  return {
    cancelled: false,
    remoteEndpoint,
    path: selected.filePath,
    revision: revisionOf(prepared.content),
    validation,
    state: 'deployment-required'
  }
}

/** Exports a validated deployment document without exposing its credentials to the renderer. */
export async function exportSavedLiterConfig(
  source: LiterConfigSource,
  expectedRevision: string,
  remoteEndpoint?: string
): Promise<LiterConfigExportResult> {
  return exportLiterConfig(source, expectedRevision, await savedGatewayEdits(), remoteEndpoint)
}
