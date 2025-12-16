import { open as openFile } from 'node:fs/promises'
import { Transform } from 'node:stream'

import * as crypto from 'crypto'
import * as fs from 'fs-extra'
import * as path from 'path'
import { pipeline } from 'stream/promises'

const MAGIC = Buffer.from('CSBACKUP', 'utf-8')
const VERSION = 1
const DEFAULT_ITERATIONS = 200_000
const SALT_LENGTH = 16
const IV_LENGTH = 12
const TAG_LENGTH = 16

const headerLength = MAGIC.length + 1 + 4 + SALT_LENGTH + IV_LENGTH

const deriveKey = (passphrase: string, salt: Buffer, iterations: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    crypto.pbkdf2(passphrase, salt, iterations, 32, 'sha256', (error, derivedKey) => {
      if (error) {
        reject(error)
        return
      }
      resolve(derivedKey)
    })
  })

const buildHeader = (salt: Buffer, iv: Buffer, iterations: number): Buffer => {
  const header = Buffer.alloc(headerLength)
  let offset = 0
  MAGIC.copy(header, offset)
  offset += MAGIC.length
  header.writeUInt8(VERSION, offset)
  offset += 1
  header.writeUInt32BE(iterations, offset)
  offset += 4
  salt.copy(header, offset)
  offset += SALT_LENGTH
  iv.copy(header, offset)
  return header
}

export const isEncryptedBackupFile = async (filePath: string): Promise<boolean> => {
  try {
    const fd = await openFile(filePath, 'r')
    try {
      const magic = Buffer.alloc(MAGIC.length)
      const { bytesRead } = await fd.read(magic, 0, MAGIC.length, 0)
      if (bytesRead !== MAGIC.length) {
        return false
      }
      return magic.equals(MAGIC)
    } finally {
      await fd.close()
    }
  } catch {
    return false
  }
}

export type BackupEncryptionOptions = {
  passphrase: string
  iterations?: number
  onProgress?: (processedBytes: number, totalBytes: number) => void
}

export const encryptBackupFile = async (
  inputPath: string,
  outputPath: string,
  options: BackupEncryptionOptions
): Promise<void> => {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS
  const salt = crypto.randomBytes(SALT_LENGTH)
  const iv = crypto.randomBytes(IV_LENGTH)
  const header = buildHeader(salt, iv, iterations)
  const key = await deriveKey(options.passphrase, salt, iterations)

  await fs.ensureDir(path.dirname(outputPath))

  const totalBytes = (await fs.stat(inputPath)).size
  let processedBytes = 0

  const progressStream = new Transform({
    transform(chunk, _encoding, callback) {
      processedBytes += chunk.length
      options.onProgress?.(processedBytes, totalBytes)
      callback(null, chunk)
    }
  })

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(header)

  await fs.writeFile(outputPath, header)
  await pipeline(
    fs.createReadStream(inputPath),
    progressStream,
    cipher,
    fs.createWriteStream(outputPath, { flags: 'a' })
  )

  const tag = cipher.getAuthTag()
  await fs.appendFile(outputPath, tag)
}

export const decryptBackupFile = async (
  inputPath: string,
  outputPath: string,
  options: BackupEncryptionOptions
): Promise<void> => {
  const fileStat = await fs.stat(inputPath)
  const fileSize = fileStat.size

  if (fileSize <= headerLength + TAG_LENGTH) {
    throw new Error('Invalid encrypted backup file')
  }

  const fd = await openFile(inputPath, 'r')
  let header: Buffer
  let tag: Buffer
  try {
    header = Buffer.alloc(headerLength)
    const headerRead = await fd.read(header, 0, headerLength, 0)
    if (headerRead.bytesRead !== headerLength) {
      throw new Error('Invalid encrypted backup header')
    }
    const magic = header.subarray(0, MAGIC.length)
    if (!magic.equals(MAGIC)) {
      throw new Error('Unsupported backup file')
    }

    const version = header.readUInt8(MAGIC.length)
    if (version !== VERSION) {
      throw new Error('Unsupported encrypted backup version')
    }

    tag = Buffer.alloc(TAG_LENGTH)
    const tagRead = await fd.read(tag, 0, TAG_LENGTH, fileSize - TAG_LENGTH)
    if (tagRead.bytesRead !== TAG_LENGTH) {
      throw new Error('Invalid encrypted backup tag')
    }
  } finally {
    await fd.close()
  }

  const iterations = header.readUInt32BE(MAGIC.length + 1)
  const saltStart = MAGIC.length + 1 + 4
  const salt = header.subarray(saltStart, saltStart + SALT_LENGTH)
  const iv = header.subarray(saltStart + SALT_LENGTH, saltStart + SALT_LENGTH + IV_LENGTH)
  const key = await deriveKey(options.passphrase, salt, iterations)

  await fs.ensureDir(path.dirname(outputPath))

  const cipherTextStart = headerLength
  const cipherTextEnd = fileSize - TAG_LENGTH - 1
  const totalBytes = cipherTextEnd - cipherTextStart + 1
  let processedBytes = 0

  const progressStream = new Transform({
    transform(chunk, _encoding, callback) {
      processedBytes += chunk.length
      options.onProgress?.(processedBytes, totalBytes)
      callback(null, chunk)
    }
  })

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(header)
  decipher.setAuthTag(tag)

  await pipeline(
    fs.createReadStream(inputPath, { start: cipherTextStart, end: cipherTextEnd }),
    progressStream,
    decipher,
    fs.createWriteStream(outputPath)
  )
}
