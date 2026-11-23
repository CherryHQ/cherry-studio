import { readFileSync } from 'node:fs'

import { app } from 'electron'

import { application } from '@application'
import type { AppEdition } from '@shared/types/appEdition'

let runtimeEdition: AppEdition | undefined

export function setRuntimeAppEdition(edition: AppEdition): void {
  runtimeEdition = edition
}

export function getAppEdition(): AppEdition {
  return runtimeEdition ?? getPackageEdition()
}

export function usesRuntimeAppEdition(): boolean {
  if (!app.isPackaged) return process.env.CHERRY_UNIFIED_RELEASE === '1'
  return getPackageMetadata().cherryUnified === true || isLegacySessionCompatibilityPackage()
}

export function isLegacySessionCompatibilityPackage(): boolean {
  if (!app.isPackaged) return false
  const { cherryRegionBridge, cherryLegacySessionCompatibility } = getPackageMetadata()
  return cherryRegionBridge === true || cherryLegacySessionCompatibility === true
}

const APPLICATION_IDS = {
  global: 'com.kangfenmao.CherryStudio',
  cn: 'com.cherryai.cherrystudio.cn'
} as const satisfies Record<AppEdition, string>

function parseAppEdition(value: unknown): AppEdition {
  if (value === undefined || value === 'global') {
    return 'global'
  }
  if (value === 'cn') {
    return 'cn'
  }
  throw new Error(`Unsupported application edition: ${String(value)}`)
}

type PackageMetadata = Record<string, unknown>
let packageMetadata: PackageMetadata | undefined

function getPackageMetadata(): PackageMetadata {
  return (packageMetadata ??= JSON.parse(readFileSync(application.getPath('app.root', 'package.json'), 'utf8')))
}

function resolveAppEdition(): AppEdition {
  const developmentEdition = process.env.CHERRY_EDITION?.trim().toLowerCase()
  if (!app.isPackaged && developmentEdition) {
    return parseAppEdition(developmentEdition)
  }

  return parseAppEdition(getPackageMetadata().cherryEdition)
}

let cachedAppEdition: AppEdition | undefined

export function getPackageEdition(): AppEdition {
  cachedAppEdition ??= resolveAppEdition()
  return cachedAppEdition
}

export function getApplicationId(): string {
  return APPLICATION_IDS[getPackageEdition()]
}
