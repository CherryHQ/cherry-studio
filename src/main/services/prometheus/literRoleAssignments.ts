import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { dialog } from 'electron'

import { application } from '@application'
import {
  literRoleAssignmentsSchema,
  type LiterRoleApplyResult,
  type LiterRoleAssignments,
  type LiterRoleDocumentSnapshot,
  type LiterRoleExportResult,
  type LiterRoleSource,
  type LiterRoleSourceSelection
} from '@shared/types/literRoles'

import { integrationDirectory, readIntegrationConfig } from './integrationConfig'

const ROLES = ['critic', 'judge', 'backup'] as const
type TomlEditor = typeof import('@rainbowatcher/toml-edit-js')

let tomlEditorReady: Promise<TomlEditor> | undefined

function revisionOf(source: string): string {
  return createHash('sha256').update(source).digest('hex')
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

async function resolveSource(source: LiterRoleSource): Promise<{ path: string; content: string; exists: boolean }> {
  if (source.ownership === 'managed') {
    const filename = path.join(integrationDirectory(), 'models.toml')
    try {
      return { path: filename, content: await fs.readFile(filename, 'utf8'), exists: true }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path: filename, content: '', exists: false }
      throw error
    }
  }
  if (!path.isAbsolute(source.path)) throw new Error('prometheus.error.literRolePath')
  const filename = await fs.realpath(source.path)
  const stat = await fs.stat(filename)
  if (!stat.isFile()) throw new Error('prometheus.error.literRolePath')
  return { path: filename, content: await fs.readFile(filename, 'utf8'), exists: true }
}

function assignmentsFromDocument(document: unknown): LiterRoleAssignments | undefined {
  if (!document || typeof document !== 'object') return undefined
  const root = document as Record<string, unknown>
  const roles = root.roles as Record<string, unknown> | undefined
  const identities = root.role_identities as Record<string, unknown> | undefined
  if (!roles || !identities) return undefined
  const assignments = Object.fromEntries(
    ROLES.map((role) => [
      role,
      {
        servedAlias: {
          gatewayConnectionId: identities[`${role}_gateway_connection_id`],
          alias: roles[role]
        },
        model: {
          providerConnectionId: identities[`${role}_provider_connection_id`],
          providerId: identities[`${role}_provider_id`],
          modelId: identities[`${role}_model_id`]
        }
      }
    ])
  )
  const parsed = literRoleAssignmentsSchema.safeParse(assignments)
  return parsed.success ? parsed.data : undefined
}

async function candidate(source: LiterRoleSource, expectedRevision: string) {
  const current = await resolveSource(source)
  const currentRevision = revisionOf(current.content)
  if (currentRevision !== expectedRevision) {
    return { current, currentRevision, conflict: { expectedRevision, currentRevision } }
  }
  const assignments = readIntegrationConfig().services.literRoles
  if (!assignments) throw new Error('prometheus.error.literRolesIncomplete')
  const { edit: editToml, parse: parseToml } = await ensureTomlEditor()
  try {
    parseToml(current.content)
    let content = current.content
    for (const role of ROLES) {
      const assignment = assignments[role]
      content = editToml(content, `roles.${role}`, assignment.servedAlias.alias)
      content = editToml(
        content,
        `role_identities.${role}_gateway_connection_id`,
        assignment.servedAlias.gatewayConnectionId
      )
      content = editToml(
        content,
        `role_identities.${role}_provider_connection_id`,
        assignment.model.providerConnectionId
      )
      content = editToml(content, `role_identities.${role}_provider_id`, assignment.model.providerId)
      content = editToml(content, `role_identities.${role}_model_id`, assignment.model.modelId)
    }
    if (!assignmentsFromDocument(parseToml(content))) throw new Error('invalid role assignment document')
    return { current, currentRevision, content }
  } catch {
    throw new Error('prometheus.error.literRoleInvalid')
  }
}

async function writeCandidate(filename: string, content: string, source: LiterRoleSource): Promise<string | undefined> {
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

export async function selectLocalLiterRoleDocument(): Promise<LiterRoleSourceSelection> {
  const selected = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'KBD model assignments', extensions: ['toml'] }]
  })
  if (selected.canceled || !selected.filePaths[0]) return { cancelled: true }
  return { ownership: 'local', path: await fs.realpath(selected.filePaths[0]) }
}

export async function readLiterRoleDocument(source: LiterRoleSource): Promise<LiterRoleDocumentSnapshot> {
  const current = await resolveSource(source)
  const { parse: parseToml } = await ensureTomlEditor()
  let assignments: LiterRoleAssignments | undefined
  try {
    assignments = assignmentsFromDocument(parseToml(current.content))
  } catch {
    throw new Error('prometheus.error.literRoleInvalid')
  }
  return {
    source,
    path: current.path,
    exists: current.exists,
    revision: revisionOf(current.content),
    ...(assignments ? { assignments } : {})
  }
}

export async function applySavedLiterRoles(
  source: LiterRoleSource,
  expectedRevision: string
): Promise<LiterRoleApplyResult> {
  const prepared = await candidate(source, expectedRevision)
  if (!('content' in prepared)) {
    return {
      source,
      state: 'conflict',
      baseRevision: prepared.currentRevision,
      nextRevision: prepared.currentRevision,
      conflict: prepared.conflict
    }
  }
  const backupPath = await writeCandidate(prepared.current.path, prepared.content, source)
  return {
    source,
    state: 'applied',
    baseRevision: prepared.currentRevision,
    nextRevision: revisionOf(prepared.content),
    appliedPath: prepared.current.path,
    ...(backupPath ? { backupPath } : {})
  }
}

export async function exportSavedLiterRoles(
  source: LiterRoleSource,
  expectedRevision: string
): Promise<LiterRoleExportResult> {
  const prepared = await candidate(source, expectedRevision)
  if (!('content' in prepared)) {
    return { cancelled: false, state: 'conflict', conflict: prepared.conflict }
  }
  const selected = await dialog.showSaveDialog({
    defaultPath: 'models.toml',
    filters: [{ name: 'KBD model assignments', extensions: ['toml'] }]
  })
  if (selected.canceled || !selected.filePath) return { cancelled: true }
  await writeCandidate(selected.filePath, prepared.content, { ownership: 'managed' })
  return {
    cancelled: false,
    state: 'deployment-required',
    path: selected.filePath,
    revision: revisionOf(prepared.content)
  }
}
