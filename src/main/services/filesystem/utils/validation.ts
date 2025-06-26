// Input validation utilities

export function validateString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`)
  }
  if (value.length === 0) {
    throw new Error(`${fieldName} cannot be empty`)
  }
  return value
}

export function validateArray(value: unknown, fieldName: string): any[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`)
  }
  return value
}

export function validateOptionalArray(value: unknown, fieldName: string): any[] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  return validateArray(value, fieldName)
}

export function validateFilePath(filePath: string): void {
  // Check for null bytes (security issue)
  if (filePath.includes('\0')) {
    throw new Error('File path contains null bytes')
  }

  // Check for extremely long paths
  if (filePath.length > 4096) {
    throw new Error('File path is too long (max 4096 characters)')
  }

  // Check for suspicious path patterns
  const suspiciousPatterns = [
    /\.\./g, // Path traversal
    /\/\//g, // Double slashes (except after protocol)
    /[<>"|*?]/g // Invalid filename characters on Windows
  ]

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(filePath)) {
      throw new Error(`File path contains invalid characters or patterns: ${filePath}`)
    }
  }
}

export function validateContent(content: string, maxSizeBytes: number = 50 * 1024 * 1024): void {
  // Check content size (default 50MB limit)
  const sizeBytes = Buffer.byteLength(content, 'utf8')
  if (sizeBytes > maxSizeBytes) {
    throw new Error(`Content too large: ${sizeBytes} bytes (max ${maxSizeBytes} bytes)`)
  }
}

export function validateSearchPattern(pattern: string): void {
  if (pattern.length === 0) {
    throw new Error('Search pattern cannot be empty')
  }

  if (pattern.length > 1000) {
    throw new Error('Search pattern is too long (max 1000 characters)')
  }

  // Try to validate regex if it looks like one
  if (pattern.startsWith('/') && pattern.endsWith('/')) {
    try {
      new RegExp(pattern.slice(1, -1))
    } catch (error) {
      throw new Error(`Invalid regex pattern: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}

export function validateEditOperations(edits: any[]): void {
  if (edits.length === 0) {
    throw new Error('At least one edit operation is required')
  }

  if (edits.length > 100) {
    throw new Error('Too many edit operations (max 100)')
  }

  for (const [index, edit] of edits.entries()) {
    if (!edit || typeof edit !== 'object') {
      throw new Error(`Edit operation ${index} must be an object`)
    }

    if (typeof edit.oldText !== 'string') {
      throw new Error(`Edit operation ${index}: oldText must be a string`)
    }

    if (typeof edit.newText !== 'string') {
      throw new Error(`Edit operation ${index}: newText must be a string`)
    }

    if (edit.oldText.length === 0) {
      throw new Error(`Edit operation ${index}: oldText cannot be empty`)
    }

    if (edit.oldText.length > 10000) {
      throw new Error(`Edit operation ${index}: oldText is too long (max 10000 characters)`)
    }

    if (edit.newText.length > 10000) {
      throw new Error(`Edit operation ${index}: newText is too long (max 10000 characters)`)
    }
  }
}
