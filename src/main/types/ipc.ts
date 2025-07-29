/**
 * IPC Communication Types for AI Agent System
 * 
 * This module defines types for Inter-Process Communication (IPC)
 * between the main process and Python child processes.
 */

// =============================================================================
// STREAMING MESSAGE TYPES
// =============================================================================

export enum MessageType {
  LOG = 'log',
  STATUS = 'status', 
  RESULT = 'result',
  ERROR = 'error',
  HEARTBEAT = 'heartbeat'
}

export enum ProcessStatus {
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPED = 'stopped',
  CRASHED = 'crashed',
  TIMEOUT = 'timeout'
}

// =============================================================================
// MESSAGE INTERFACES
// =============================================================================

export interface BaseMessage {
  type: MessageType
  timestamp: number
  session_id: string
}

export interface LogMessage extends BaseMessage {
  type: MessageType.LOG
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  context?: Record<string, any>
}

export interface StatusMessage extends BaseMessage {
  type: MessageType.STATUS
  status: ProcessStatus
  details?: string
}

export interface ResultMessage extends BaseMessage {
  type: MessageType.RESULT
  data: any
  metadata?: Record<string, any>
}

export interface ErrorMessage extends BaseMessage {
  type: MessageType.ERROR
  error: string
  stack?: string
  code?: string
}

export interface HeartbeatMessage extends BaseMessage {
  type: MessageType.HEARTBEAT
  pid: number
  memory_usage?: number
  cpu_usage?: number
}

export type IPCMessage = LogMessage | StatusMessage | ResultMessage | ErrorMessage | HeartbeatMessage

// =============================================================================
// PROCESS CONFIGURATION
// =============================================================================

export interface ProcessConfig {
  script_path: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  timeout?: number
  max_memory?: number
  heartbeat_interval?: number
}

// =============================================================================
// PROCESS METRICS
// =============================================================================

export interface ProcessMetrics {
  pid: number
  memory_usage: number
  cpu_usage: number
  uptime: number
  last_heartbeat: number
}

// =============================================================================
// BUFFER MANAGEMENT
// =============================================================================

export interface MessageBuffer {
  buffer: string
  messages: IPCMessage[]
  incomplete_message?: string
}