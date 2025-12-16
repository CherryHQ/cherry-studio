const ENCRYPTION_PREFIX = 'csenc:'

export const CREDENTIAL_ISSUE_EVENT_NAME = 'cherrystudio:credential-issue'

export type CredentialIssueReason = 'decrypt_failed'

export interface CredentialIssue {
  id: string
  reason: CredentialIssueReason
  timestamp: number
  meta?: Record<string, unknown>
}

const credentialIssueQueue: CredentialIssue[] = []
const credentialIssueKeys = new Set<string>()

const publishCredentialIssue = (issue: CredentialIssue): void => {
  const key = `${issue.reason}:${issue.id}`
  if (credentialIssueKeys.has(key)) return
  credentialIssueKeys.add(key)
  credentialIssueQueue.push(issue)

  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(CREDENTIAL_ISSUE_EVENT_NAME, { detail: issue }))
    }
  } catch {
    // Ignore.
  }
}

export const reportCredentialDecryptFailure = (id: string, meta?: Record<string, unknown>): void => {
  publishCredentialIssue({
    id,
    reason: 'decrypt_failed',
    timestamp: Date.now(),
    meta
  })
}

export const consumeCredentialIssues = (): CredentialIssue[] => {
  const issues = credentialIssueQueue.splice(0, credentialIssueQueue.length)
  credentialIssueKeys.clear()
  return issues
}

const isEncryptionAvailable = (): boolean => {
  try {
    return Boolean(window.api?.safeStorage?.isEncryptionAvailable?.())
  } catch {
    return false
  }
}

export const encryptSecret = (value: string): string => {
  try {
    return window.api?.safeStorage?.encryptString?.(value) ?? value
  } catch {
    return value
  }
}

export const decryptSecret = (value: string): string => {
  try {
    const decrypted = window.api?.safeStorage?.decryptString?.(value) ?? value
    if (value.startsWith(ENCRYPTION_PREFIX) && decrypted === value) {
      return ''
    }
    return decrypted
  } catch {
    return value.startsWith(ENCRYPTION_PREFIX) ? '' : value
  }
}

export const decryptSecretWithIssue = (value: string, issueId?: string, meta?: Record<string, unknown>): string => {
  const decrypted = decryptSecret(value)
  if (issueId && value.startsWith(ENCRYPTION_PREFIX) && decrypted === '') {
    reportCredentialDecryptFailure(issueId, meta)
  }
  return decrypted
}

export const setEncryptedLocalStorageItem = (key: string, value: string): void => {
  localStorage.setItem(key, encryptSecret(value))
}

export const getDecryptedLocalStorageItem = (key: string): string | null => {
  const raw = localStorage.getItem(key)
  if (raw === null) {
    return null
  }

  const decrypted = decryptSecretWithIssue(raw, `localStorage.${key}`, { scope: 'localStorage', storageKey: key })

  if (raw.startsWith(ENCRYPTION_PREFIX) && decrypted === '') {
    localStorage.removeItem(key)
    return null
  }

  // Migrate legacy plaintext to encrypted-at-rest storage when available.
  if (!raw.startsWith(ENCRYPTION_PREFIX) && isEncryptionAvailable()) {
    setEncryptedLocalStorageItem(key, raw)
  }

  return decrypted
}
