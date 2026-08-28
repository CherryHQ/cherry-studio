// Channel log & status types
export type ChannelLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type ChannelLogEntry = {
  timestamp: number
  level: ChannelLogLevel
  message: string
  channelId: string
}

export type ChannelStatusEvent = {
  channelId: string
  connected: boolean
  error?: string
}
