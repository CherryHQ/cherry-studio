import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ExternalProcess, ExternalSnapshot, ExternalTarget } from './externalAppDriver'
import { externalAppRequest } from './externalAppDriver'
import type { RunPaths } from './paths'
import { resolveAllowedPath } from './paths'
import type { Platform } from './types'

interface ExternalResource {
  id: string
  platform: Platform
  target: ExternalTarget
  baseline: ExternalSnapshot
  acquired: ExternalSnapshot
}

const sameProcess = (a: ExternalProcess, b: ExternalProcess) => a.pid === b.pid && a.startedAt === b.startedAt
const emptySnapshot = (): ExternalSnapshot => ({ processes: [], windows: [] })
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

function diagnosticSnapshot(snapshot: ExternalSnapshot) {
  return {
    processes: snapshot.processes.slice(0, 32).map(({ pid, startedAt }) => ({ pid, startedAt })),
    windows: snapshot.windows.slice(0, 32).map(({ id, pid, matches }) => ({ id, pid, matches })),
    truncated: snapshot.processes.length > 32 || snapshot.windows.length > 32
  }
}

function ledgerPath(paths: RunPaths): string {
  return join(paths.private, 'external-resources.json')
}

function readResources(paths: RunPaths): ExternalResource[] {
  const path = ledgerPath(paths)
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as ExternalResource[]) : []
}

function writeResources(paths: RunPaths, resources: ExternalResource[]): void {
  mkdirSync(paths.private, { recursive: true })
  const path = ledgerPath(paths)
  const temporary = `${path}.tmp`
  writeFileSync(temporary, JSON.stringify(resources), { mode: 0o600 })
  renameSync(temporary, path)
}

export function registerExternalResource(paths: RunPaths, platform: Platform, target: ExternalTarget): string {
  if ('path' in target && target.path) resolveAllowedPath(target.path, [paths.root])
  if ('directory' in target) resolveAllowedPath(target.directory, [paths.root])
  const baseline = externalAppRequest(platform, { action: 'inspect', target, root: paths.root })
  if (target.kind === 'browser' && baseline.browserApplication)
    target = { ...target, application: baseline.browserApplication }
  const id = randomUUID()
  writeResources(paths, [...readResources(paths), { id, platform, target, baseline, acquired: emptySnapshot() }])
  return id
}

function acquire(resource: ExternalResource, snapshot: ExternalSnapshot): void {
  const windows = snapshot.windows.filter(
    (window) => window.matches && !resource.baseline.windows.some((previous) => previous.id === window.id)
  )
  for (const window of windows) {
    if (!resource.acquired.windows.some(({ id }) => id === window.id)) resource.acquired.windows.push(window)
  }
  const processes = snapshot.processes.filter(
    (process) =>
      !resource.baseline.processes.some((previous) => sameProcess(previous, process)) &&
      !resource.acquired.processes.some(
        (previous) => previous.pid === process.pid && !sameProcess(previous, process)
      ) &&
      windows.some(({ pid }) => pid === process.pid)
  )
  for (const process of processes) {
    if (!resource.acquired.processes.some((previous) => sameProcess(previous, process)))
      resource.acquired.processes.push(process)
  }
}

export function observeExternalResource(paths: RunPaths, id: string): boolean {
  const resources = readResources(paths)
  const resource = resources.find((resource) => resource.id === id)
  if (!resource) throw new Error(`External resource registration is missing: ${id}`)
  const snapshot = externalAppRequest(resource.platform, {
    action: 'inspect',
    target: resource.target,
    root: paths.root
  })
  acquire(resource, snapshot)
  writeResources(paths, resources)
  return snapshot.windows.some(
    (window) => window.matches && resource.acquired.windows.some(({ id }) => id === window.id)
  )
}

export function cleanupExternalResources(paths: RunPaths, ids?: string[]): void {
  const resources = readResources(paths)
  const errors: unknown[] = []
  for (const resource of [...resources].reverse()) {
    if (ids && !ids.includes(resource.id)) continue
    const snapshots = new Map<string, ReturnType<typeof diagnosticSnapshot>>()
    const closes: {
      requestedId: string
      found: boolean | null
      matches: boolean | null
      dispatched: boolean | null
    }[] = []
    let closeCount = 0
    const request = (
      action: 'inspect' | 'close' | 'quit' | 'force',
      extra: { process?: ExternalProcess; window?: ExternalSnapshot['windows'][number]; owned?: string[] } = {}
    ) => {
      let result: ExternalSnapshot | undefined
      try {
        result = externalAppRequest(resource.platform, { action, target: resource.target, root: paths.root, ...extra })
        if (action === 'close') snapshots.set('after-close', diagnosticSnapshot(result))
        return result
      } finally {
        if (action === 'close' && extra.window) {
          closeCount += 1
          if (closes.length < 32)
            closes.push({
              requestedId: extra.window.id,
              found: result?.close?.found ?? null,
              matches: result?.close?.matches ?? null,
              dispatched: result?.close?.dispatched ?? null
            })
        }
      }
    }
    try {
      let snapshot = request('inspect')
      snapshots.set('before-close', diagnosticSnapshot(snapshot))
      acquire(resource, snapshot)
      writeResources(paths, resources)
      const owned = resource.acquired.windows.map(({ id }) => id)
      const failures: unknown[] = []
      const closeErrors: unknown[] = []
      if (
        !owned.length &&
        snapshot.windows.some((window) => !resource.baseline.windows.some(({ id }) => id === window.id))
      )
        failures.push(new Error(`New external windows could not be linked to registration ${resource.id}`))
      for (const window of snapshot.windows.filter(({ id }) => owned.includes(id))) {
        if (!window.matches) {
          failures.push(new Error(`External window ${window.id} contains unrelated content; refusing to close`))
          continue
        }
        const process = snapshot.processes.find(({ pid }) => pid === window.pid)
        try {
          request('close', { process, window })
        } catch (error) {
          closeErrors.push(error)
        }
      }
      for (const process of resource.acquired.processes) {
        if (process.shared) continue
        snapshot = request('inspect')
        snapshots.set('pre-quit', diagnosticSnapshot(snapshot))
        if (!snapshot.processes.some((current) => sameProcess(current, process))) continue
        if (
          snapshot.windows.some(
            (window) => window.pid === process.pid && (!owned.includes(window.id) || !window.matches)
          )
        ) {
          failures.push(new Error(`External application ${process.pid} has unrelated windows; refusing to quit`))
          continue
        }
        try {
          request('quit', { process, owned })
          snapshot = request('inspect')
          if (snapshot.processes.some((current) => sameProcess(current, process))) {
            request('force', { process, owned })
            snapshot = request('inspect')
          }
          if (snapshot.processes.some((current) => sameProcess(current, process)))
            throw new Error(`External application ${process.pid} did not exit`)
        } catch (error) {
          failures.push(error)
        }
      }
      snapshot = request('inspect')
      snapshots.set('final', diagnosticSnapshot(snapshot))
      const remaining = snapshot.windows.filter(({ id }) => owned.includes(id))
      if (remaining.length)
        failures.push(
          ...closeErrors,
          new Error(`External windows remain open: ${remaining.map(({ id }) => id).join(', ')}`)
        )
      if (failures.length)
        throw new AggregateError(failures, `External resource ${resource.id}: ${failures.map(message).join('; ')}`)
      resources.splice(resources.indexOf(resource), 1)
    } catch (error) {
      errors.push(error)
      try {
        const diagnosticDirectory = join(paths.evidence, 'native-diagnostics')
        mkdirSync(diagnosticDirectory, { recursive: true })
        writeFileSync(
          join(diagnosticDirectory, `external-cleanup-${resource.id}.json`),
          JSON.stringify({
            baseline: diagnosticSnapshot(resource.baseline),
            acquired: diagnosticSnapshot(resource.acquired),
            snapshots: [...snapshots].map(([stage, snapshot]) => ({ stage, ...snapshot })),
            closes,
            closesTruncated: closeCount > closes.length
          }),
          { mode: 0o600 }
        )
      } catch {
        // Diagnostic I/O must preserve the cleanup refusal and its private ledger.
      }
    }
    writeResources(paths, resources)
  }
  if (errors.length)
    throw new AggregateError(errors, `External application cleanup failed: ${errors.map(message).join('; ')}`)
}
