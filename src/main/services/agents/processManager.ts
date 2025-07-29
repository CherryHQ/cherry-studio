/**
 * AgentProcessManager - Python Child Process Management System
 * 
 * This module provides:
 * - Process lifecycle management (spawn, monitor, terminate)
 * - Streaming IPC communication with JSON message parsing
 * - Resource monitoring and cleanup
 * - Error handling and recovery
 */

import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import { loggerService } from '@logger'
import { 
  ProcessConfig, 
  ProcessStatus, 
  IPCMessage, 
  MessageType, 
  MessageBuffer,
  ProcessMetrics
} from '../../types/ipc'

const logger = loggerService.withContext('AgentProcessManager')

// =============================================================================
// INTERFACES
// =============================================================================

export interface ManagedProcess {
  sessionId: string
  childProcess: ChildProcess
  status: ProcessStatus
  config: ProcessConfig
  startTime: number
  metrics?: ProcessMetrics
  messageBuffer: MessageBuffer
}

export interface ProcessStatusUpdate {
  sessionId: string
  status: ProcessStatus
  details?: string
}

export interface ProcessError {
  sessionId: string
  error: string
  stack?: string
}

// =============================================================================
// AGENT PROCESS MANAGER
// =============================================================================

export class AgentProcessManager extends EventEmitter {
  private processes = new Map<string, ManagedProcess>()
  private readonly TERMINATION_TIMEOUT = 5000 // 5 seconds
  private readonly DEFAULT_HEARTBEAT_INTERVAL = 30000 // 30 seconds
  private heartbeatTimers = new Map<string, NodeJS.Timeout>()

  constructor() {
    super()
    logger.info('AgentProcessManager initialized')
    
    // Periodic cleanup of stale processes
    this.setupPeriodicCleanup()
  }

  // ===========================================================================
  // PUBLIC METHODS
  // ===========================================================================

  /**
   * Start a new Python process for the given session
   */
  async startProcess(sessionId: string, config: ProcessConfig): Promise<ManagedProcess> {
    logger.info('Starting process for session', { sessionId, scriptPath: config.script_path })

    // Validation
    if (this.processes.has(sessionId)) {
      throw new Error('Process already running for session')
    }

    if (!fs.existsSync(config.script_path)) {
      throw new Error('Script file does not exist')
    }

    // Create child process
    const args = [config.script_path, ...(config.args || [])]
    const childProcess = spawn('python', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...config.env },
      cwd: config.cwd
    })

    // Create managed process object
    const managedProcess: ManagedProcess = {
      sessionId,
      childProcess,
      status: ProcessStatus.STARTING,
      config,
      startTime: Date.now(),
      messageBuffer: {
        buffer: '',
        messages: []
      }
    }

    this.processes.set(sessionId, managedProcess)

    // Set up event handlers
    this.setupProcessHandlers(managedProcess)
    
    // Set up heartbeat monitoring
    this.setupHeartbeatMonitoring(managedProcess)

    return managedProcess
  }

  /**
   * Stop a process with graceful shutdown and timeout
   */
  async stopProcess(sessionId: string): Promise<void> {
    logger.info('Stopping process for session', { sessionId })

    const managedProcess = this.processes.get(sessionId)
    if (!managedProcess) {
      throw new Error('Process not found for session')
    }

    return new Promise<void>((resolve, reject) => {
      const { childProcess } = managedProcess

      // Set up exit handler
      const exitHandler = (code: number | null, signal: string | null) => {
        logger.info('Process exited', { sessionId, code, signal })
        this.cleanupProcess(sessionId)
        resolve()
      }

      childProcess.once('exit', exitHandler)

      // Try graceful shutdown first
      childProcess.kill('SIGTERM')

      // Force kill after timeout
      const forceKillTimer = setTimeout(() => {
        logger.warn('Process did not exit gracefully, force killing', { sessionId })
        childProcess.kill('SIGKILL')
      }, this.TERMINATION_TIMEOUT)

      // Clean up timer when process exits
      childProcess.once('exit', () => {
        clearTimeout(forceKillTimer)
      })
    })
  }

  /**
   * Get process information by session ID
   */
  getProcess(sessionId: string): ManagedProcess | undefined {
    return this.processes.get(sessionId)
  }

  /**
   * Get all active processes
   */
  getAllProcesses(): ManagedProcess[] {
    return Array.from(this.processes.values())
  }

  /**
   * Get process statistics
   */
  getProcessStats(): {
    totalProcesses: number
    runningProcesses: number
    memoryUsage: number
    avgCpuUsage: number
  } {
    const processes = this.getAllProcesses()
    const runningProcesses = processes.filter(p => p.status === ProcessStatus.RUNNING)
    
    const totalMemory = processes.reduce((sum, p) => sum + (p.metrics?.memory_usage || 0), 0)
    const avgCpu = processes.length > 0 
      ? processes.reduce((sum, p) => sum + (p.metrics?.cpu_usage || 0), 0) / processes.length
      : 0

    return {
      totalProcesses: processes.length,
      runningProcesses: runningProcesses.length,
      memoryUsage: totalMemory,
      avgCpuUsage: avgCpu
    }
  }

  /**
   * Clean up all processes
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up all processes')
    
    const sessions = Array.from(this.processes.keys())
    const cleanupPromises = sessions.map(sessionId => this.stopProcess(sessionId))
    
    await Promise.allSettled(cleanupPromises)
    this.processes.clear()
    
    // Clear heartbeat timers
    for (const timer of this.heartbeatTimers.values()) {
      clearTimeout(timer)
    }
    this.heartbeatTimers.clear()
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Set up event handlers for a managed process
   */
  private setupProcessHandlers(managedProcess: ManagedProcess): void {
    const { sessionId, childProcess } = managedProcess

    // Handle process spawn
    childProcess.on('spawn', () => {
      logger.info('Process spawned successfully', { sessionId, pid: childProcess.pid })
      managedProcess.status = ProcessStatus.RUNNING
      this.emitStatusUpdate(sessionId, ProcessStatus.RUNNING)
    })

    // Handle stdout data (IPC messages)
    childProcess.stdout?.on('data', (data: Buffer) => {
      this.handleStdoutData(managedProcess, data)
    })

    // Handle stderr data (error messages)
    childProcess.stderr?.on('data', (data: Buffer) => {
      const errorMessage = data.toString().trim()
      logger.error('Process stderr output', { sessionId, error: errorMessage })
      
      this.emit('error', {
        sessionId,
        error: errorMessage
      })
    })

    // Handle process errors
    childProcess.on('error', (error: Error) => {
      logger.error('Process error', error, { sessionId })
      
      // Only update status if not already crashed
      if (managedProcess.status !== ProcessStatus.CRASHED) {
        managedProcess.status = ProcessStatus.CRASHED
        this.emitStatusUpdate(sessionId, ProcessStatus.CRASHED)
      }
      
      this.emit('error', {
        sessionId,
        error: error.message,
        stack: error.stack
      })
    })

    // Handle process exit
    childProcess.on('exit', (code: number | null, signal: string | null) => {
      logger.info('Process exited', { sessionId, code, signal })
      
      // Only emit status update if not already crashed
      if (managedProcess.status !== ProcessStatus.CRASHED) {
        if (code !== 0 && !signal) {
          managedProcess.status = ProcessStatus.CRASHED
          this.emitStatusUpdate(sessionId, ProcessStatus.CRASHED)
        } else {
          managedProcess.status = ProcessStatus.STOPPED
          this.emitStatusUpdate(sessionId, ProcessStatus.STOPPED)
        }
      }
      
      this.cleanupProcess(sessionId)
    })
  }

  /**
   * Handle stdout data and parse JSON messages
   */
  private handleStdoutData(managedProcess: ManagedProcess, data: Buffer): void {
    const { sessionId, messageBuffer } = managedProcess
    
    // Append new data to buffer
    messageBuffer.buffer += data.toString('utf8')
    
    // Prevent buffer from growing too large (DoS protection)
    const MAX_BUFFER_SIZE = 1024 * 1024 // 1MB
    if (messageBuffer.buffer.length > MAX_BUFFER_SIZE) {
      logger.warn('Message buffer exceeded maximum size, truncating', { 
        sessionId, 
        bufferSize: messageBuffer.buffer.length 
      })
      messageBuffer.buffer = messageBuffer.buffer.slice(-MAX_BUFFER_SIZE / 2)
    }
    
    // Process complete messages (separated by newlines)
    const lines = messageBuffer.buffer.split('\n')
    messageBuffer.buffer = lines.pop() || '' // Keep incomplete line in buffer
    
    // Batch process messages for better performance
    const messages: IPCMessage[] = []
    
    for (const line of lines) {
      const trimmedLine = line.trim()
      if (trimmedLine) {
        try {
          const message: IPCMessage = JSON.parse(trimmedLine)
          messages.push(message)
        } catch (error) {
          logger.error('Failed to parse JSON message', error, { sessionId, line: trimmedLine })
          this.emit('error', {
            sessionId,
            error: `Failed to parse JSON message: ${trimmedLine}`
          })
        }
      }
    }
    
    // Process all messages at once
    for (const message of messages) {
      this.handleIPCMessage(managedProcess, message)
    }
    
    // Update message buffer statistics
    messageBuffer.messages.push(...messages)
    
    // Limit message history to prevent memory leaks
    const MAX_MESSAGE_HISTORY = 1000
    if (messageBuffer.messages.length > MAX_MESSAGE_HISTORY) {
      messageBuffer.messages = messageBuffer.messages.slice(-MAX_MESSAGE_HISTORY / 2)
    }
  }

  /**
   * Handle parsed IPC message
   */
  private handleIPCMessage(managedProcess: ManagedProcess, message: IPCMessage): void {
    const { sessionId } = managedProcess
    
    logger.debug('Received IPC message', { sessionId, type: message.type })
    
    // Update metrics for heartbeat messages
    if (message.type === MessageType.HEARTBEAT) {
      const heartbeat = message as any
      managedProcess.metrics = {
        pid: heartbeat.pid,
        memory_usage: heartbeat.memory_usage,
        cpu_usage: heartbeat.cpu_usage,
        uptime: Date.now() - managedProcess.startTime,
        last_heartbeat: Date.now()
      }
    }
    
    // Emit message for listeners
    this.emit('message', message)
  }

  /**
   * Emit status update event
   */
  private emitStatusUpdate(sessionId: string, status: ProcessStatus, details?: string): void {
    this.emit('statusUpdate', {
      sessionId,
      status,
      details
    })
  }

  /**
   * Clean up process resources
   */
  private cleanupProcess(sessionId: string): void {
    logger.debug('Cleaning up process resources', { sessionId })
    
    // Clear heartbeat timer
    const timer = this.heartbeatTimers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      this.heartbeatTimers.delete(sessionId)
    }
    
    this.processes.delete(sessionId)
  }

  /**
   * Set up heartbeat monitoring for a process
   */
  private setupHeartbeatMonitoring(managedProcess: ManagedProcess): void {
    const { sessionId, config } = managedProcess
    const heartbeatInterval = config.heartbeat_interval || this.DEFAULT_HEARTBEAT_INTERVAL
    
    const checkHeartbeat = () => {
      const process = this.processes.get(sessionId)
      if (!process || process.status !== ProcessStatus.RUNNING) {
        return // Process no longer active
      }
      
      const now = Date.now()
      const lastHeartbeat = process.metrics?.last_heartbeat || process.startTime
      const timeSinceHeartbeat = now - lastHeartbeat
      
      if (timeSinceHeartbeat > heartbeatInterval * 2) {
        logger.warn('Process heartbeat timeout detected', { 
          sessionId, 
          timeSinceHeartbeat,
          heartbeatInterval 
        })
        
        process.status = ProcessStatus.TIMEOUT
        this.emitStatusUpdate(sessionId, ProcessStatus.TIMEOUT, 'Heartbeat timeout')
        
        // Attempt to terminate the process
        process.childProcess.kill('SIGTERM')
      } else {
        // Schedule next heartbeat check
        const timer = setTimeout(checkHeartbeat, heartbeatInterval)
        this.heartbeatTimers.set(sessionId, timer)
      }
    }
    
    // Initial heartbeat check
    const timer = setTimeout(checkHeartbeat, heartbeatInterval)
    this.heartbeatTimers.set(sessionId, timer)
  }

  /**
   * Set up periodic cleanup of stale processes
   */
  private setupPeriodicCleanup(): void {
    const CLEANUP_INTERVAL = 60000 // 1 minute
    
    setInterval(() => {
      const staleProcesses = Array.from(this.processes.entries()).filter(([sessionId, process]) => {
        const age = Date.now() - process.startTime
        const maxAge = process.config.timeout || 3600000 // Default 1 hour
        
        return age > maxAge && process.status !== ProcessStatus.RUNNING
      })
      
      for (const [sessionId] of staleProcesses) {
        logger.info('Cleaning up stale process', { sessionId })
        this.cleanupProcess(sessionId)
      }
      
      if (staleProcesses.length > 0) {
        logger.info('Cleaned up stale processes', { count: staleProcesses.length })
      }
    }, CLEANUP_INTERVAL)
  }
}