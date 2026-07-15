import fs from 'node:fs'
import path from 'node:path'

const MAX_FILE_BYTES = 10 * 1024 * 1024

function localDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export class DailyLogWriter {
  private stream?: fs.WriteStream
  private streamDate = ''
  private bytesWritten = 0
  private fileIndex = 0

  constructor(
    private readonly logsDir: string,
    private readonly prefix: 'app' | 'app-error',
    maxAgeDays: number
  ) {
    fs.mkdirSync(logsDir, { recursive: true })
    this.removeExpiredFiles(maxAgeDays)
  }

  write(line: string): void {
    this.ensureStream(Buffer.byteLength(line))
    this.bytesWritten += Buffer.byteLength(line)
    this.stream?.write(line)
  }

  finish(): void {
    this.stream?.end()
    this.stream = undefined
  }

  private ensureStream(nextBytes: number): void {
    const date = localDate()
    if (this.stream && this.streamDate === date && this.bytesWritten + nextBytes <= MAX_FILE_BYTES) return

    this.stream?.end()
    if (this.streamDate !== date) {
      this.streamDate = date
      this.fileIndex = 0
    } else {
      this.fileIndex += 1
    }

    let filePath = this.resolveFilePath(date, this.fileIndex)
    let existingSize = this.fileSize(filePath)
    while (existingSize + nextBytes > MAX_FILE_BYTES) {
      this.fileIndex += 1
      filePath = this.resolveFilePath(date, this.fileIndex)
      existingSize = this.fileSize(filePath)
    }

    this.bytesWritten = existingSize
    this.stream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' })
    this.stream.on('error', (error) => {
      process.stderr.write(`[LoggerService] Failed to write ${this.prefix} log: ${error.stack ?? error.message}\n`)
    })
  }

  private resolveFilePath(date: string, index: number): string {
    const suffix = index === 0 ? '' : `.${index}`
    return path.join(this.logsDir, `${this.prefix}.${date}${suffix}.log`)
  }

  private fileSize(filePath: string): number {
    try {
      return fs.statSync(filePath).size
    } catch {
      return 0
    }
  }

  private removeExpiredFiles(maxAgeDays: number): void {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    const escapedPrefix = this.prefix.replace('-', '\\-')
    const pattern = new RegExp(`^${escapedPrefix}\\.\\d{4}-\\d{2}-\\d{2}(?:\\.\\d+)?\\.log$`)

    for (const name of fs.readdirSync(this.logsDir)) {
      if (!pattern.test(name)) continue
      const filePath = path.join(this.logsDir, name)
      try {
        if (fs.statSync(filePath).mtimeMs < cutoff) fs.unlinkSync(filePath)
      } catch {
        // Log retention is best-effort and must never block app startup.
      }
    }
  }
}
