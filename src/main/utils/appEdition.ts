import { readFileSync } from 'node:fs'

import { app } from 'electron'

import { application } from '@application'
import type { AppEdition } from '@shared/types/appEdition'
import { APP_ID } from '@shared/utils/branding'

// Must stay in sync with `appId` in electron-builder.yml and
// electron-builder.cn.config.cjs; appEdition.test.ts reads both and asserts it.
const APPLICATION_IDS = {
  global: APP_ID,
  cn: `${APP_ID}.cn`
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

function resolveAppEdition(): AppEdition {
  const developmentEdition = process.env.CHERRY_EDITION?.trim().toLowerCase()
  if (!app.isPackaged && developmentEdition) {
    return parseAppEdition(developmentEdition)
  }

  const packageMetadata = JSON.parse(readFileSync(application.getPath('app.root', 'package.json'), 'utf8')) as {
    cherryEdition?: unknown
  }

  return parseAppEdition(packageMetadata.cherryEdition)
}

let cachedAppEdition: AppEdition | undefined

export function getAppEdition(): AppEdition {
  cachedAppEdition ??= resolveAppEdition()
  return cachedAppEdition
}

export function getApplicationId(): string {
  return APPLICATION_IDS[getAppEdition()]
}
