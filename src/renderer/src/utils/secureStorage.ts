const ENCRYPTION_PREFIX = 'csenc:'

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

export const setEncryptedLocalStorageItem = (key: string, value: string): void => {
  localStorage.setItem(key, encryptSecret(value))
}

export const getDecryptedLocalStorageItem = (key: string): string | null => {
  const raw = localStorage.getItem(key)
  if (raw === null) {
    return null
  }

  const decrypted = decryptSecret(raw)

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
