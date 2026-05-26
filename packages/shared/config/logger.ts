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

export const LOG_LEVEL_OPTIONS: { value: LogLevel; label: string }[] = [
  { value: LEVEL.ERROR, label: 'Error' },
  { value: LEVEL.WARN, label: 'Warn' },
  { value: LEVEL.INFO, label: 'Info' },
  { value: LEVEL.DEBUG, label: 'Debug' },
  { value: LEVEL.VERBOSE, label: 'Verbose' },
  { value: LEVEL.SILLY, label: 'Silly' }
]
