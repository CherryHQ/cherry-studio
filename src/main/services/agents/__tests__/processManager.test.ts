import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import fs from 'fs'
import { AgentProcessManager } from '../processManager'
import { ProcessStatus, MessageType } from '../../../types/ipc'
import type { ChildProcess } from 'child_process'

// Mock child_process module
vi.mock('child_process', () => ({
  spawn: vi.fn()
}))

// Mock fs module for script validation
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    constants: {
      F_OK: 0
    }
  },
  existsSync: vi.fn(),
  constants: {
    F_OK: 0
  }
}))

// Mock logger
vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

describe('AgentProcessManager', () => {
  let processManager: AgentProcessManager
  let mockChildProcess: EventEmitter & { 
    pid: number 
    kill: ReturnType<typeof vi.fn>
    stdout: EventEmitter
    stderr: EventEmitter
  }

  beforeEach(() => {
    processManager = new AgentProcessManager()
    
    // Create mock child process
    mockChildProcess = new EventEmitter() as any
    mockChildProcess.pid = 12345
    mockChildProcess.kill = vi.fn()
    mockChildProcess.stdout = new EventEmitter()
    mockChildProcess.stderr = new EventEmitter()
    
    // Mock spawn to return our mock process
    vi.mocked(spawn).mockReturnValue(mockChildProcess as ChildProcess)
    
    // Mock fs.existsSync to return true for script validation
    vi.mocked(fs.existsSync).mockReturnValue(true)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Process Lifecycle', () => {
    it('should spawn Python child process with proper stdio pipe configuration', async () => {
      const sessionId = 'test-session-123'
      const scriptPath = '/path/to/script.py'
      
      const process = await processManager.startProcess(sessionId, {
        script_path: scriptPath,
        args: ['--arg1', 'value1'],
        env: { PYTHON_ENV: 'test' }
      })
      
      expect(process).toBeDefined()
      expect(process.sessionId).toBe(sessionId)
      expect(process.status).toBe(ProcessStatus.STARTING)
      
      expect(spawn).toHaveBeenCalledWith(
        'python',
        [scriptPath, '--arg1', 'value1'],
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
          env: expect.objectContaining({ PYTHON_ENV: 'test' })
        })
      )
    })

    it('should handle process startup and emit status updates', async () => {
      const sessionId = 'test-session-456'
      const statusUpdates: any[] = []
      
      processManager.on('statusUpdate', (update) => {
        statusUpdates.push(update)
      })
      
      const process = await processManager.startProcess(sessionId, {
        script_path: '/path/to/script.py'
      })
      
      // Simulate process startup
      mockChildProcess.emit('spawn')
      
      // Wait for event to be processed
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(statusUpdates).toHaveLength(1)
      expect(statusUpdates[0]).toEqual(
        expect.objectContaining({
          sessionId,
          status: 'running'
        })
      )
    })

    it('should terminate process within 5 seconds when stopping agent', async () => {
      const sessionId = 'test-session-789'
      
      await processManager.startProcess(sessionId, {
        script_path: '/path/to/script.py'
      })
      
      // Simulate running process
      mockChildProcess.emit('spawn')
      
      const startTime = Date.now()
      
      // Start termination
      const stopPromise = processManager.stopProcess(sessionId)
      
      // Simulate process exit after some delay
      setTimeout(() => {
        mockChildProcess.emit('exit', 0, null)
      }, 100)
      
      await stopPromise
      
      const endTime = Date.now()
      const duration = endTime - startTime
      
      expect(duration).toBeLessThan(5000)
      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM')
    })

    it('should force kill process after timeout if graceful shutdown fails', async () => {
      const sessionId = 'test-timeout'
      
      await processManager.startProcess(sessionId, {
        script_path: '/path/to/script.py',
        timeout: 1000 // 1 second timeout for testing
      })
      
      mockChildProcess.emit('spawn')
      
      // Start termination but don't emit exit immediately
      const stopPromise = processManager.stopProcess(sessionId)
      
      // Wait for timeout and then simulate force kill and exit
      setTimeout(() => {
        mockChildProcess.emit('exit', -1, 'SIGKILL')
      }, 5100) // After the 5 second timeout
      
      await expect(stopPromise).resolves.toBeUndefined()
      
      // Verify both SIGTERM and SIGKILL were called
      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM')
      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGKILL')
    }, 10000)
  })

  describe('IPC Communication', () => {
    it('should handle streaming JSON messages with buffer management', async () => {
      const sessionId = 'ipc-test-session'
      const receivedMessages: any[] = []
      
      processManager.on('message', (message) => {
        receivedMessages.push(message)
      })
      
      await processManager.startProcess(sessionId, {
        script_path: '/path/to/script.py'
      })
      
      // Simulate partial JSON message
      const partialMessage = '{"type":"log","timestamp":'
      mockChildProcess.stdout.emit('data', Buffer.from(partialMessage))
      
      // Complete the message
      const completeMessage = '1234567890,"session_id":"ipc-test-session","level":"info","message":"Test log"}\n'
      mockChildProcess.stdout.emit('data', Buffer.from(completeMessage))
      
      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toEqual({
        type: MessageType.LOG,
        timestamp: 1234567890,
        session_id: 'ipc-test-session',
        level: 'info',
        message: 'Test log'
      })
    })

    it('should handle multiple JSON messages in single buffer', async () => {
      const sessionId = 'multi-message-session'
      const receivedMessages: any[] = []
      
      processManager.on('message', (message) => {
        receivedMessages.push(message)
      })
      
      await processManager.startProcess(sessionId, {
        script_path: '/path/to/script.py'
      })
      
      // Send multiple messages in one buffer
      const multipleMessages = 
        '{"type":"status","timestamp":1000,"session_id":"multi-message-session","status":"running"}\n' +
        '{"type":"log","timestamp":2000,"session_id":"multi-message-session","level":"debug","message":"Debug info"}\n'
      
      mockChildProcess.stdout.emit('data', Buffer.from(multipleMessages))
      
      expect(receivedMessages).toHaveLength(2)
      expect(receivedMessages[0].type).toBe(MessageType.STATUS)
      expect(receivedMessages[1].type).toBe(MessageType.LOG)
    })

    it('should handle malformed JSON messages gracefully', async () => {
      const sessionId = 'malformed-json-session'
      const errorEvents: any[] = []
      
      processManager.on('error', (error) => {
        errorEvents.push(error)
      })
      
      await processManager.startProcess(sessionId, {
        script_path: '/path/to/script.py'
      })
      
      // Send malformed JSON
      const malformedJson = '{"type":"log","invalid":json}\n'
      mockChildProcess.stdout.emit('data', Buffer.from(malformedJson))
      
      expect(errorEvents).toHaveLength(1)
      expect(errorEvents[0]).toEqual(
        expect.objectContaining({
          sessionId,
          error: expect.stringContaining('Failed to parse JSON message')
        })
      )
    })
  })

  describe('Error Handling', () => {
    it('should clean up resources when process crashes', async () => {
      const sessionId = 'crash-test-session'
      const statusUpdates: any[] = []
      const errorEvents: any[] = []
      
      processManager.on('statusUpdate', (update) => {
        statusUpdates.push(update)
      })
      
      processManager.on('error', (error) => {
        errorEvents.push(error)
      })
      
      await processManager.startProcess(sessionId, {
        script_path: '/path/to/script.py'
      })
      
      // Simulate process crash
      mockChildProcess.emit('error', new Error('Process crashed'))
      mockChildProcess.emit('exit', 1, null)
      
      // Wait for events to be processed
      await new Promise(resolve => setTimeout(resolve, 10))
      
      // Check that resources are cleaned up - process should be removed from registry
      const process = processManager.getProcess(sessionId)
      expect(process).toBeUndefined()
      
      // Verify status update was emitted
      expect(statusUpdates).toHaveLength(1)
      expect(statusUpdates[0]).toEqual(
        expect.objectContaining({
          sessionId,
          status: 'crashed'
        })
      )
      
      // Verify error event was emitted
      expect(errorEvents).toHaveLength(1)
      expect(errorEvents[0]).toEqual(
        expect.objectContaining({
          sessionId,
          error: 'Process crashed'
        })
      )
    })

    it('should handle stderr output as error messages', async () => {
      const sessionId = 'stderr-test-session'
      const errorMessages: any[] = []
      
      processManager.on('error', (error) => {
        errorMessages.push(error)
      })
      
      await processManager.startProcess(sessionId, {
        script_path: '/path/to/script.py'
      })
      
      // Simulate stderr output
      const errorOutput = 'Python error: Module not found\n'
      mockChildProcess.stderr.emit('data', Buffer.from(errorOutput))
      
      expect(errorMessages).toHaveLength(1)
      expect(errorMessages[0]).toEqual(
        expect.objectContaining({
          sessionId,
          error: 'Python error: Module not found'
        })
      )
    })

    it('should validate script path exists before spawning process', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      
      const sessionId = 'invalid-script-session'
      
      await expect(
        processManager.startProcess(sessionId, {
          script_path: '/nonexistent/script.py'
        })
      ).rejects.toThrow('Script file does not exist')
    })

    it('should prevent starting multiple processes for same session', async () => {
      const sessionId = 'duplicate-session'
      
      await processManager.startProcess(sessionId, {
        script_path: '/path/to/script.py'
      })
      
      await expect(
        processManager.startProcess(sessionId, {
          script_path: '/path/to/another-script.py'
        })
      ).rejects.toThrow('Process already running for session')
    })
  })

  describe('Resource Management', () => {
    it('should track process metrics including memory and CPU usage', async () => {
      const sessionId = 'metrics-test-session'
      
      await processManager.startProcess(sessionId, {
        script_path: '/path/to/script.py'
      })
      
      mockChildProcess.emit('spawn')
      
      // Simulate heartbeat message with metrics
      const heartbeatMessage = JSON.stringify({
        type: MessageType.HEARTBEAT,
        timestamp: Date.now(),
        session_id: sessionId,
        pid: 12345,
        memory_usage: 50 * 1024 * 1024, // 50MB
        cpu_usage: 15.5
      }) + '\n'
      
      mockChildProcess.stdout.emit('data', Buffer.from(heartbeatMessage))
      
      const process = processManager.getProcess(sessionId)
      expect(process?.metrics).toEqual(
        expect.objectContaining({
          pid: 12345,
          memory_usage: 50 * 1024 * 1024,
          cpu_usage: 15.5
        })
      )
    })

    it('should provide list of all active processes', async () => {
      const session1 = 'session-1'
      const session2 = 'session-2'
      
      await processManager.startProcess(session1, {
        script_path: '/path/to/script1.py'
      })
      
      await processManager.startProcess(session2, {
        script_path: '/path/to/script2.py'
      })
      
      const activeProcesses = processManager.getAllProcesses()
      
      expect(activeProcesses).toHaveLength(2)
      expect(activeProcesses.map(p => p.sessionId)).toContain(session1)
      expect(activeProcesses.map(p => p.sessionId)).toContain(session2)
    })

    it('should clean up process from registry on exit', async () => {
      const sessionId = 'cleanup-test-session'
      
      await processManager.startProcess(sessionId, {
        script_path: '/path/to/script.py'
      })
      
      expect(processManager.getProcess(sessionId)).toBeDefined()
      
      // Simulate process exit
      mockChildProcess.emit('exit', 0, null)
      
      // Process should be removed from registry after cleanup
      expect(processManager.getProcess(sessionId)).toBeUndefined()
    })

    it('should provide process statistics', async () => {
      const session1 = 'stats-session-1'
      const session2 = 'stats-session-2'
      
      await processManager.startProcess(session1, {
        script_path: '/path/to/script1.py'
      })
      
      await processManager.startProcess(session2, {
        script_path: '/path/to/script2.py'
      })
      
      // Simulate running processes
      mockChildProcess.emit('spawn')
      
      const stats = processManager.getProcessStats()
      
      expect(stats.totalProcesses).toBe(2)
      expect(stats.runningProcesses).toBe(2)
      expect(stats.memoryUsage).toBe(0) // No metrics yet
      expect(stats.avgCpuUsage).toBe(0) // No metrics yet
    })

    it('should handle buffer overflow protection', async () => {
      const sessionId = 'buffer-overflow-session'
      
      await processManager.startProcess(sessionId, {
        script_path: '/path/to/script.py'
      })
      
      // Send a very large buffer (simulate DoS attempt)
      const largeData = 'x'.repeat(2 * 1024 * 1024) // 2MB
      mockChildProcess.stdout.emit('data', Buffer.from(largeData))
      
      // Process should still be running (not crashed)
      const process = processManager.getProcess(sessionId)
      expect(process).toBeDefined()
    })

    it('should clean up all processes on manager cleanup', async () => {
      const session1 = 'cleanup-all-session-1'
      const session2 = 'cleanup-all-session-2'
      
      await processManager.startProcess(session1, {
        script_path: '/path/to/script1.py'
      })
      
      await processManager.startProcess(session2, {
        script_path: '/path/to/script2.py'
      })
      
      expect(processManager.getAllProcesses()).toHaveLength(2)
      
      // Simulate process exit responses
      setTimeout(() => {
        mockChildProcess.emit('exit', 0, null)
      }, 50)
      
      await processManager.cleanup()
      
      expect(processManager.getAllProcesses()).toHaveLength(0)
    })
  })
})