import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { isLinux, isMac, isWin } from '@main/core/platform'
import type { UserDataRelocationValidationReason } from '@shared/types/userDataRelocation'

import type { PendingRelocation } from './types'

// Chromium writes these marker files into an actively used profile directory.
// Their presence in a proposed target means another (possibly still running)
// Cherry Studio instance owns that directory, so relocation must not touch it.
const ACTIVE_PROFILE_MARKERS = ['SingletonLock', 'SingletonSocket'] as const

export class RelocationValidationError extends Error {
  constructor(
    readonly reason: UserDataRelocationValidationReason,
    message: string
  ) {
    super(message)
    this.name = 'RelocationValidationError'
  }
}

export function invalid(reason: UserDataRelocationValidationReason, message: string): never {
  throw new RelocationValidationError(reason, message)
}

export function assertUserDataRelocationRequest(pending: PendingRelocation): void {
  const inspection = assertRelocationPaths(pending.from, pending.to, { taskId: pending.taskId })
  if (!pending.copy && !inspection.targetExists) {
    invalid('target_missing', `switch target does not exist: ${pending.to}`)
  }
  if (pending.copy && !inspection.targetEmpty) {
    invalid('target_not_empty', `copy target must be empty: ${pending.to}`)
  }
}

/**
 * Full source/target validation shared by the inspect, request, and execution
 * faces. Checks run against both the literal paths and their symlink-resolved
 * effective paths, so a symlinked alias can never smuggle a target inside the
 * source tree (or vice versa). Throws RelocationValidationError; returns what
 * the target currently looks like for mode-specific checks.
 */
export function assertRelocationPaths(
  fromValue: string,
  toValue: string,
  options: { allowRelocationArtifacts?: boolean; taskId?: string } = {}
): { targetExists: boolean; targetEmpty: boolean } {
  if (!path.isAbsolute(fromValue)) invalid('source_missing', `source must be an absolute path: ${fromValue}`)
  if (!path.isAbsolute(toValue)) invalid('target_not_absolute', `target must be an absolute path: ${toValue}`)

  const from = normalizeForCompare(fromValue)
  const to = normalizeForCompare(toValue)
  if (from === to) invalid('same_path', `source and target are the same path: ${toValue}`)
  if (isRootPath(toValue)) invalid('target_root', `target must not be a filesystem root: ${toValue}`)
  if (isPathInside(to, from)) invalid('target_inside_source', `target is inside source: ${toValue}`)
  if (isPathInside(from, to)) invalid('target_contains_source', `target contains source: ${toValue}`)

  assertDirectory(fromValue, 'source', 'source_missing')
  fs.accessSync(fromValue, fs.constants.R_OK)

  const targetExists = pathEntryExists(toValue)
  const targetAncestor = resolveExistingAncestor(toValue)
  if (!fs.statSync(targetAncestor.path).isDirectory()) {
    invalid('target_parent_unwritable', `target ancestor is not a directory: ${targetAncestor.path}`)
  }

  const fromReal = normalizeForCompare(realPath(fromValue))
  const toEffective = normalizeForCompare(targetAncestor.effectivePath)
  if (fromReal === toEffective) invalid('same_path', `source and target resolve to the same path: ${toValue}`)
  if (isPathInside(toEffective, fromReal)) {
    invalid('target_inside_source', `target real path is inside source: ${toValue}`)
  }
  if (isPathInside(fromReal, toEffective)) {
    invalid('target_contains_source', `target real path contains source: ${toValue}`)
  }

  assertTargetIsNotProtected(toValue, toEffective)
  try {
    fs.accessSync(targetExists ? toValue : targetAncestor.path, fs.constants.W_OK)
  } catch {
    invalid('target_parent_unwritable', `target is not writable: ${toValue}`)
  }

  let targetEmpty = true
  if (targetExists) {
    assertDirectory(toValue, 'target', 'target_not_directory')
    const entries = fs.readdirSync(toValue)
    targetEmpty = entries.length === 0
    if (ACTIVE_PROFILE_MARKERS.some((marker) => entries.includes(marker))) {
      invalid(
        'target_in_use',
        `target appears to be an active userData directory; close other Cherry Studio instances, or remove stale SingletonLock and SingletonSocket markers if none are running: ${toValue}`
      )
    }
  }

  if (options.taskId) {
    const { workPath, asidePath } = relocationArtifactPaths(toValue, options.taskId)
    if (!options.allowRelocationArtifacts && (pathEntryExists(workPath) || pathEntryExists(asidePath))) {
      invalid('target_work_conflict', `relocation work paths already exist beside target: ${toValue}`)
    }
  }

  return { targetExists, targetEmpty }
}

/**
 * Three protection layers, checked in order:
 *   1. application trees (relocation session root, install, app root, extra
 *      resources, cherry home) — rejected on overlap in either direction;
 *   2. well-known user/system directories (home, appdata, temp, downloads, …)
 *      — rejected on exact match only, so app-specific subdirectories stay
 *      selectable;
 *   3. OS top-level directories (/usr, C:\Windows, …) — rejected on exact
 *      match for the current platform (on Windows, only on the system volume).
 */
function assertTargetIsNotProtected(target: string, normalizedTarget: string): void {
  const protectedApplicationTrees = [
    application.getPath('app.temp', 'relocation-session'),
    application.getPath('app.install'),
    application.getPath('app.root'),
    application.getPath('app.extra_resources'),
    application.getPath('cherry.home')
  ]
  for (const protectedTree of protectedApplicationTrees) {
    const normalizedProtected = normalizeForCompare(resolveEffectivePath(protectedTree))
    if (
      normalizedTarget === normalizedProtected ||
      isPathInside(normalizedTarget, normalizedProtected) ||
      isPathInside(normalizedProtected, normalizedTarget)
    ) {
      invalid('target_protected', `target overlaps a protected application or system directory: ${target}`)
    }
  }

  const systemHome = application.getPath('sys.home')
  const protectedExact = [
    systemHome,
    ...(isWin ? [path.dirname(systemHome)] : []),
    application.getPath('sys.appdata'),
    application.getPath('sys.temp'),
    application.getPath('sys.downloads'),
    application.getPath('sys.documents'),
    application.getPath('sys.desktop'),
    application.getPath('sys.music'),
    application.getPath('sys.pictures'),
    application.getPath('sys.videos')
  ]
  if (protectedExact.some((value) => normalizeForCompare(resolveEffectivePath(value)) === normalizedTarget)) {
    invalid('target_protected', `target is a protected user or system directory: ${target}`)
  }

  const resolved = path.resolve(target)
  const relative = path.relative(path.parse(resolved).root, resolved)
  const segments = relative.split(path.sep).filter(Boolean)
  const firstSegment = segments[0]?.toLowerCase()
  const isWindowsSystemVolume =
    isWin &&
    normalizeForCompare(path.parse(resolved).root) ===
      normalizeForCompare(path.parse(application.getPath('sys.appdata')).root)
  const protectedTopLevel = isWindowsSystemVolume
    ? ['windows', 'program files', 'program files (x86)', 'programdata', 'recovery', '$recycle.bin']
    : isMac
      ? ['system', 'library', 'applications', 'bin', 'sbin', 'usr', 'private']
      : isLinux
        ? ['bin', 'boot', 'dev', 'etc', 'lib', 'lib64', 'proc', 'root', 'run', 'sbin', 'sys', 'usr', 'var']
        : []
  if (segments.length === 1 && firstSegment && protectedTopLevel.includes(firstSegment)) {
    invalid('target_protected', `target is a protected operating-system directory: ${target}`)
  }
}

/**
 * Symlink-aware separation check for paths claimed during execution. Unlike
 * assertRelocationPaths this throws a plain Error: it guards work paths mid
 * transaction, where the failure is reported (and rolled back) rather than
 * mapped to a user-facing validation reason.
 */
export function assertEffectiveSeparation(source: string, target: string): void {
  const sourceReal = normalizeForCompare(realPath(source))
  const targetEffective = normalizeForCompare(resolveEffectivePath(target))
  if (sourceReal === targetEffective || isPathInside(targetEffective, sourceReal)) {
    throw new Error(`target real path is inside source: ${target}`)
  }
  if (isPathInside(sourceReal, targetEffective)) {
    throw new Error(`target real path contains source: ${target}`)
  }
}

export function assertEmptyDirectory(directory: string, message: string): void {
  assertDirectory(directory, 'relocation artifact', 'target_work_conflict')
  if (fs.readdirSync(directory).length > 0) {
    invalid('target_work_conflict', `${message}: ${directory}`)
  }
}

function assertDirectory(value: string, label: string, reason: UserDataRelocationValidationReason): void {
  try {
    if (!fs.statSync(value).isDirectory()) invalid(reason, `${label} is not a directory: ${value}`)
  } catch (error) {
    if (error instanceof RelocationValidationError) throw error
    invalid(reason, `${label} directory does not exist or is inaccessible: ${value}`)
  }
}

/**
 * Work/aside sibling paths for one relocation task. Both live beside the
 * target (same volume, so promotion is a rename) and embed the task ID so
 * recovery can tell this task's artifacts from anything else.
 */
export function relocationArtifactPaths(target: string, taskId: string): { workPath: string; asidePath: string } {
  const parent = path.dirname(target)
  const name = path.basename(target)
  return {
    workPath: path.join(parent, `.${name}.cherry-relocation-${taskId}-work`),
    asidePath: path.join(parent, `.${name}.cherry-relocation-${taskId}-aside`)
  }
}

export function resolveEffectivePath(value: string): string {
  return resolveExistingAncestor(value).effectivePath
}

/**
 * The target may not exist yet. Walk up to the nearest existing ancestor and
 * return it plus the "effective path": that ancestor's realpath with the
 * missing tail re-appended — what the target will really resolve to once
 * created, which is what all symlink-safe comparisons must use.
 */
export function resolveExistingAncestor(value: string): { path: string; effectivePath: string } {
  let cursor = path.resolve(value)
  const missingParts: string[] = []
  while (!pathEntryExists(cursor)) {
    const parent = path.dirname(cursor)
    if (parent === cursor) {
      invalid('target_parent_unwritable', `no existing ancestor for target: ${value}`)
    }
    missingParts.unshift(path.basename(cursor))
    cursor = parent
  }
  return { path: cursor, effectivePath: path.join(realPath(cursor), ...missingParts) }
}

export function realPath(value: string): string {
  return fs.realpathSync.native?.(value) ?? fs.realpathSync(value)
}

export function pathEntryExists(value: string): boolean {
  try {
    fs.lstatSync(value)
    return true
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return false
    throw error
  }
}

function isRootPath(value: string): boolean {
  const resolved = path.resolve(value)
  return normalizeForCompare(resolved) === normalizeForCompare(path.parse(resolved).root)
}

// Windows and macOS default filesystems are case-insensitive; compare paths
// case-folded there so "/Data" and "/data" count as the same directory.
export function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value)
  return isWin || isMac ? resolved.toLowerCase() : resolved
}

export function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
