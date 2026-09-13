import { readFileSync } from 'node:fs'

import { app } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import type { AppEdition } from '@shared/types/appEdition'

const logger = loggerService.withContext('AppEdition')

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

function resolveAppEdition(): AppEdition {
  const developmentEdition = process.env.CHERRY_EDITION?.trim().toLowerCase()
  if (!app.isPackaged && developmentEdition) {
    const edition = parseAppEdition(developmentEdition)
    // Pin the resolved edition in logs so a packaged build hiding providers
    // can be told apart from edition policy doing it on purpose (#20405).
    logger.info('Resolved application edition', { edition, isPackaged: app.isPackaged, raw: developmentEdition })
    return edition
  }

  const packageMetadata = JSON.parse(readFileSync(application.getPath('app.root', 'package.json'), 'utf8')) as {
    cherryEdition?: unknown
  }

  const edition = parseAppEdition(packageMetadata.cherryEdition)
  logger.info('Resolved application edition', {
    edition,
    isPackaged: app.isPackaged,
    raw: packageMetadata.cherryEdition ?? null
  })
  return edition
}

let cachedAppEdition: AppEdition | undefined

export function getAppEdition(): AppEdition {
  cachedAppEdition ??= resolveAppEdition()
  return cachedAppEdition
}

export function getApplicationId(): string {
  return APPLICATION_IDS[getAppEdition()]
}
