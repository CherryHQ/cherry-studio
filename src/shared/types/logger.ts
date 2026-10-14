export type LogSourceWithContext = {
  process: 'main' | 'renderer'
  window?: string // only for renderer process
  module?: string
  context?: Record<string, any>
}

type NullableObject = object | undefined | null

export type LogContextData = [] | [Error | NullableObject] | [Error | NullableObject, ...NullableObject[]]

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose' | 'silly' | 'none'

export const LEVEL = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  VERBOSE: 'verbose',
  SILLY: 'silly',
  NONE: 'none'
} satisfies Record<string, LogLevel>

export const LEVEL_MAP: Record<LogLevel, number> = {
  error: 10,
  warn: 8,
  info: 6,
  debug: 4,
  verbose: 2,
  silly: 0,
  none: -1
}

/** Log retention windows offered in settings, in days. */
export const LOG_RETENTION_DAYS = [7, 14, 30, 90] as const

/**
 * The longest retention a user can pick, and therefore the cap the rotating
 * transports keep as a backstop — LogRetentionService enforces the chosen value.
 */
export const MAX_LOG_RETENTION_DAYS = Math.max(...LOG_RETENTION_DAYS)
