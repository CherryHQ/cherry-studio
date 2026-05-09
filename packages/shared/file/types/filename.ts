const FORBIDDEN_FILENAME_CHARS = /[/\\:*?"<>|]/g

const WIN_FORBIDDEN_CHARS = /[<>:"/\\|?*]/
const WIN_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i

const MAX_FILENAME_LENGTH = 255

export type ValidateFileNameResult = { valid: true } | { valid: false; error: string }

export function sanitizeFilename(input: string, replacement: string = '_'): string {
  return input.replace(FORBIDDEN_FILENAME_CHARS, replacement)
}

export function validateFileName(
  fileName: string,
  platform: NodeJS.Platform = process.platform
): ValidateFileNameResult {
  if (!fileName) {
    return { valid: false, error: 'File name cannot be empty' }
  }

  if (fileName.length > MAX_FILENAME_LENGTH) {
    return { valid: false, error: `File name length must be between 1 and ${MAX_FILENAME_LENGTH} characters` }
  }

  if (fileName.includes('\0')) {
    return { valid: false, error: 'File name cannot contain null characters.' }
  }

  if (platform === 'win32') {
    if (WIN_FORBIDDEN_CHARS.test(fileName)) {
      return { valid: false, error: 'File name contains characters not supported by Windows: < > : " / \\ | ? *' }
    }
    if (WIN_RESERVED_NAMES.test(fileName)) {
      return { valid: false, error: 'File name is a Windows reserved name.' }
    }
    if (fileName.endsWith('.') || fileName.endsWith(' ')) {
      return { valid: false, error: 'File name cannot end with a dot or a space' }
    }
  }

  return { valid: true }
}
