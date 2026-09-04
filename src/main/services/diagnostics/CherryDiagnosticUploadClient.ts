import { createHash } from 'node:crypto'
import { openAsBlob } from 'node:fs'
import path from 'node:path'

import { generateDiagnosticUploadHeaders } from '@main/ai/provider/cherryai'
import { openReadableFileSnapshot, type ReadableFileSnapshot } from '@main/utils/file'
import type { DiagnosticUploadFailureReason } from '@shared/ipc/schemas/diagnostics'
import type { AbsoluteFilePath } from '@shared/types/file'
import { normalizeDiagnosticDescription } from '@shared/utils/diagnostics'
import { net } from 'electron'

export const DIAGNOSTIC_UPLOAD_URL = 'https://api.cherry-ai.com/diagnostics'
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
const MAX_RESPONSE_BYTES = 64 * 1024
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000

export type CherryDiagnosticUploadFailureReason = DiagnosticUploadFailureReason

export type CherryDiagnosticUploadResult =
  | { status: 'uploaded'; reportId: string }
  | { status: 'rejected'; reason: CherryDiagnosticUploadFailureReason; fileSha256?: string }
  | { status: 'submission_unknown'; fileSha256: string }

export interface CherryDiagnosticUploadInput {
  description: string
  expectedFileSha256?: string
  fileName: string
  filePath: AbsoluteFilePath
}

function rejected(reason: CherryDiagnosticUploadFailureReason, fileSha256?: string): CherryDiagnosticUploadResult {
  return fileSha256 ? { fileSha256, reason, status: 'rejected' } : { reason, status: 'rejected' }
}

function isZipPath(value: string): boolean {
  return path.extname(value).toLowerCase() === '.zip'
}

function hasSameIdentity(first: ReadableFileSnapshot, second: ReadableFileSnapshot): boolean {
  return (
    first.dev === second.dev &&
    first.ino === second.ino &&
    first.modifiedAt === second.modifiedAt &&
    first.size === second.size
  )
}

async function hashSnapshot(snapshot: ReadableFileSnapshot): Promise<string> {
  const hash = createHash('sha256')
  let bytesRead = 0
  for await (const chunk of snapshot.createReadStream()) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytesRead += buffer.byteLength
    if (bytesRead > snapshot.size) throw new Error('Diagnostic archive changed while hashing')
    hash.update(buffer)
  }
  if (bytesRead !== snapshot.size) throw new Error('Diagnostic archive changed while hashing')
  return hash.digest('hex')
}

async function matchesOpenedSnapshot(filePath: AbsoluteFilePath, expected: ReadableFileSnapshot): Promise<boolean> {
  let current: ReadableFileSnapshot | undefined
  try {
    current = await openReadableFileSnapshot(filePath)
    return hasSameIdentity(expected, current)
  } catch {
    return false
  } finally {
    await current?.close().catch(() => undefined)
  }
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

async function readResponseBody(response: Response): Promise<Buffer> {
  const contentLengthHeader = response.headers.get('content-length')
  if (contentLengthHeader !== null) {
    const normalized = contentLengthHeader.trim()
    const contentLength = Number(normalized)
    if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(contentLength) || contentLength > MAX_RESPONSE_BYTES) {
      await cancelBody(response)
      throw new Error('Invalid diagnostic upload response length')
    }
  }

  const reader = response.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Buffer[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('Diagnostic upload response is too large')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, totalBytes)
}

function parseResponseJson(body: Buffer): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function uploadedResult(body: Buffer, fileSha256: string): CherryDiagnosticUploadResult {
  try {
    const value = parseResponseJson(body)
    if (!isRecord(value) || typeof value.id !== 'string' || value.id.trim().length === 0) {
      return { fileSha256, status: 'submission_unknown' }
    }
    return { reportId: value.id, status: 'uploaded' }
  } catch {
    return { fileSha256, status: 'submission_unknown' }
  }
}

function rejectedResult(response: Response, fileSha256: string, body?: Buffer): CherryDiagnosticUploadResult {
  if (response.status === 400 && body) {
    try {
      const value = parseResponseJson(body)
      if (isRecord(value) && value.code === 'invalid_diagnostic_archive') {
        return rejected('invalid_archive', fileSha256)
      }
    } catch {
      return rejected('submission_rejected', fileSha256)
    }
  }
  if (response.status === 401 || response.status === 409) return rejected('authentication_failed', fileSha256)
  if (response.status === 413) return rejected('archive_too_large', fileSha256)
  if (response.status === 429) return rejected('rate_limited', fileSha256)
  if (response.status === 502) return rejected('service_unavailable', fileSha256)
  return rejected('submission_rejected', fileSha256)
}

export class CherryDiagnosticUploadClient {
  async upload(input: CherryDiagnosticUploadInput): Promise<CherryDiagnosticUploadResult> {
    if (!isZipPath(input.fileName)) return rejected('invalid_archive')

    let snapshot: ReadableFileSnapshot | undefined
    try {
      try {
        snapshot = await openReadableFileSnapshot(input.filePath)
      } catch {
        return rejected('invalid_archive')
      }
      if (snapshot.size <= 0) return rejected('invalid_archive')
      if (snapshot.size > MAX_ARCHIVE_BYTES) return rejected('archive_too_large')

      let fileSha256: string
      try {
        fileSha256 = await hashSnapshot(snapshot)
      } catch {
        return rejected('invalid_archive')
      }
      if (input.expectedFileSha256 !== undefined && fileSha256 !== input.expectedFileSha256) {
        return rejected('invalid_archive')
      }

      const description = normalizeDiagnosticDescription(input.description)
      let signatureHeaders
      try {
        signatureHeaders = generateDiagnosticUploadHeaders({ description, fileSha256, fileSize: snapshot.size })
      } catch {
        return rejected('authentication_failed', fileSha256)
      }

      let file: Blob
      try {
        file = await openAsBlob(input.filePath, { type: 'application/zip' })
      } catch {
        return rejected('invalid_archive')
      }
      if (!(await matchesOpenedSnapshot(input.filePath, snapshot))) return rejected('invalid_archive')

      const form = new FormData()
      form.append('description', description)
      form.append('file', file, input.fileName)

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        let response: Response
        try {
          response = await net.fetch(DIAGNOSTIC_UPLOAD_URL, {
            body: form,
            headers: { ...signatureHeaders },
            method: 'POST',
            redirect: 'manual',
            signal: controller.signal
          })
        } catch {
          return { fileSha256, status: 'submission_unknown' }
        }

        if (!response.ok && response.status !== 400) {
          await cancelBody(response)
          return rejectedResult(response, fileSha256)
        }

        try {
          const body = await readResponseBody(response)
          return response.ok ? uploadedResult(body, fileSha256) : rejectedResult(response, fileSha256, body)
        } catch {
          return response.ok
            ? { fileSha256, status: 'submission_unknown' }
            : rejected('submission_rejected', fileSha256)
        }
      } finally {
        clearTimeout(timeout)
      }
    } finally {
      await snapshot?.close().catch(() => undefined)
    }
  }
}

export const cherryDiagnosticUploadClient = new CherryDiagnosticUploadClient()
