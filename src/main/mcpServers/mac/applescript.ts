import { loggerService } from '@logger'
import { spawn } from 'child_process'

const logger = loggerService.withContext('MacMCP')

// Input validation constants
export const MAX_INPUT_LENGTHS = {
  noteTitle: 500,
  noteContent: 50000,
  emailSubject: 1000,
  emailBody: 100000,
  searchQuery: 500,
  eventTitle: 500,
  reminderName: 500
}

// Timeouts per operation type (in milliseconds)
// Apps like Calendar, Notes, Mail may need time to launch and sync with iCloud
export const TIMEOUT_MS = {
  list: 15000, // 15s - app launch + iterate items
  search: 20000, // 20s - app launch + search through content
  create: 10000, // 10s - app launch + create item
  open: 5000, // 5s - app launch
  send: 15000 // 15s - email sending with network
}

// Result limits
export const MAX_RESULTS = {
  notes: 20,
  emails: 10,
  events: 15,
  reminders: 30,
  mailboxes: 50,
  contentPreview: 300
}

// CRITICAL: Sanitize all user inputs for AppleScript
export function sanitizeAppleScriptString(input: string): string {
  return input
    .replace(/\\/g, '\\\\') // Escape backslashes first
    .replace(/"/g, '\\"') // Escape double quotes
    .replace(/\n/g, '\\n') // Escape newlines
    .replace(/\r/g, '\\r') // Escape carriage returns
    .replace(/\0/g, '') // Remove null bytes
}

// Validate input before passing to AppleScript
export function validateInput(input: string, maxLength: number, fieldName: string): void {
  if (!input || input.trim() === '') {
    throw new Error(`${fieldName} cannot be empty`)
  }
  if (input.length > maxLength) {
    throw new Error(`${fieldName} exceeds maximum length of ${maxLength}`)
  }
  // Check for suspicious patterns (shell script attempts)
  if (/do shell script|system events|terminal/i.test(input)) {
    logger.warn('Suspicious input detected', { fieldName, inputLength: input.length })
    throw new Error('Input contains potentially unsafe commands')
  }
}

// Execute AppleScript with proper timeout and error handling
// Uses stdin (-) to handle multi-line scripts properly
export function runAppleScript(script: string, timeoutMs: number = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    logger.debug('Executing AppleScript', { scriptLength: script.length })

    const proc = spawn('osascript', ['-'], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    // Set timeout
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
      logger.error('AppleScript timeout', { timeoutMs })
      reject(new Error(`Operation timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      clearTimeout(timer)

      if (timedOut) return

      if (stderr) {
        logger.warn('AppleScript stderr output', { stderr: stderr.trim() })
      }

      if (code !== 0) {
        logger.error('AppleScript execution failed', {
          code,
          stderr: stderr.trim(),
          scriptLength: script.length
        })
        reject(new Error(`AppleScript error: ${stderr.trim() || `exit code ${code}`}`))
        return
      }

      resolve(stdout.trim())
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      logger.error('AppleScript spawn error', { error: err.message })
      reject(new Error(`Failed to execute AppleScript: ${err.message}`))
    })

    // Write script to stdin and close
    proc.stdin.write(script)
    proc.stdin.end()
  })
}
