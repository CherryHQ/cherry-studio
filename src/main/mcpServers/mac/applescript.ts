import { execFile } from 'child_process'
import { promisify } from 'util'
import { loggerService } from '@logger'

const logger = loggerService.withContext('MacMCP')
const execFileAsync = promisify(execFile)

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

// Timeouts per operation type
export const TIMEOUT_MS = {
  list: 3000,
  search: 5000,
  create: 5000,
  open: 2000,
  send: 8000
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
    .replace(/\\/g, '\\\\')   // Escape backslashes first
    .replace(/"/g, '\\"')      // Escape double quotes
    .replace(/\n/g, '\\n')     // Escape newlines
    .replace(/\r/g, '\\r')     // Escape carriage returns
    .replace(/\0/g, '')        // Remove null bytes
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
export async function runAppleScript(
  script: string,
  timeoutMs: number = 5000
): Promise<string> {
  try {
    logger.debug('Executing AppleScript', { scriptLength: script.length })

    const { stdout, stderr } = await execFileAsync(
      'osascript',
      ['-e', script],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 }
    )

    if (stderr) {
      logger.warn('AppleScript stderr output', { stderr })
    }

    return stdout.trim()
  } catch (error) {
    const err = error as Error & { code?: string }

    if (err.code === 'ETIMEDOUT') {
      logger.error('AppleScript timeout', { timeoutMs })
      throw new Error(`Operation timed out after ${timeoutMs}ms`)
    }

    logger.error('AppleScript execution failed', {
      error: err.message,
      scriptLength: script.length
    })
    throw error
  }
}
