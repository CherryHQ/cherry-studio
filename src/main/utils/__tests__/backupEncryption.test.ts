import * as fs from 'fs-extra'
import * as path from 'path'
import { describe, expect, it } from 'vitest'

import { decryptBackupFile, encryptBackupFile, isEncryptedBackupFile } from '../backupEncryption'

describe('backupEncryption', () => {
  it('encrypts and decrypts backup files', async () => {
    const tempDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-backup-encryption-'))
    try {
      const inputPath = path.join(tempDir, 'plain.zip')
      const encryptedPath = path.join(tempDir, 'backup.csbackup')
      const outputPath = path.join(tempDir, 'decrypted.zip')

      await fs.writeFile(inputPath, Buffer.from('hello world', 'utf-8'))

      await encryptBackupFile(inputPath, encryptedPath, { passphrase: 'test-passphrase', iterations: 1000 })
      expect(await isEncryptedBackupFile(encryptedPath)).toBe(true)

      await decryptBackupFile(encryptedPath, outputPath, { passphrase: 'test-passphrase' })
      const decrypted = await fs.readFile(outputPath, 'utf-8')
      expect(decrypted).toBe('hello world')
    } finally {
      await fs.remove(tempDir)
    }
  })

  it('fails to decrypt with a wrong passphrase', async () => {
    const tempDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-backup-encryption-'))
    try {
      const inputPath = path.join(tempDir, 'plain.zip')
      const encryptedPath = path.join(tempDir, 'backup.csbackup')
      const outputPath = path.join(tempDir, 'decrypted.zip')

      await fs.writeFile(inputPath, Buffer.from('hello world', 'utf-8'))
      await encryptBackupFile(inputPath, encryptedPath, { passphrase: 'correct', iterations: 1000 })

      await expect(decryptBackupFile(encryptedPath, outputPath, { passphrase: 'wrong' })).rejects.toBeTruthy()
    } finally {
      await fs.remove(tempDir)
    }
  })

  it('detects encrypted backup file magic', async () => {
    const tempDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-backup-encryption-'))
    try {
      const plainPath = path.join(tempDir, 'plain.zip')
      const encryptedPath = path.join(tempDir, 'backup.csbackup')

      await fs.writeFile(plainPath, Buffer.from('plain', 'utf-8'))
      await encryptBackupFile(plainPath, encryptedPath, { passphrase: 'test', iterations: 1000 })

      expect(await isEncryptedBackupFile(plainPath)).toBe(false)
      expect(await isEncryptedBackupFile(encryptedPath)).toBe(true)
    } finally {
      await fs.remove(tempDir)
    }
  })
})
