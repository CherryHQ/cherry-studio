import { readFileSync } from 'node:fs'

import { app } from 'electron'

import { application } from '@application'
import type { AppEdition } from '@shared/types/appEdition'

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

type PackageMetadata = { cherryEdition?: unknown; cherryUnified?: boolean; cherryRegionBridge?: boolean }
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

let runtimeEdition: AppEdition | undefined

export function setRuntimeAppEdition(edition: AppEdition): void {
  runtimeEdition = edition
}

export function getAppEdition(): AppEdition {
  return runtimeEdition ?? getPackageEdition()
}

export function isUnifiedPackage(): boolean {
  return app.isPackaged ? getPackageMetadata().cherryUnified === true : process.env.CHERRY_UNIFIED_RELEASE === '1'
}

export function isRegionBridgePackage(): boolean {
  return app.isPackaged && getPackageMetadata().cherryRegionBridge === true
}
