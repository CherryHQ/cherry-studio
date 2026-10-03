import { IpcError } from './IpcError'

export const channelErrorCodes = {
  CHANNEL_NOT_FOUND: 'CHANNEL_NOT_FOUND',
  CHANNEL_CONFIG_INVALID: 'CHANNEL_CONFIG_INVALID'
} as const

export function isChannelNotFoundError(error: unknown): error is IpcError {
  return error instanceof IpcError && error.code === channelErrorCodes.CHANNEL_NOT_FOUND
}

export function isChannelConfigInvalidError(error: unknown): error is IpcError {
  return error instanceof IpcError && error.code === channelErrorCodes.CHANNEL_CONFIG_INVALID
}
