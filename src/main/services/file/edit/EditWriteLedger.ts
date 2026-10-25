import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { FileWriteOutcome } from '@shared/ipc/schemas/fileEdit'

export class EditWriteLedger {
  private current?: {
    sequence: number
    fingerprint?: string
    settled: boolean
    task: Promise<FileWriteOutcome>
  }

  write(sequence: number, fingerprint: string, commit: () => Promise<FileWriteOutcome>): Promise<FileWriteOutcome> {
    if (this.current?.sequence === sequence) {
      if (this.current.fingerprint !== undefined && this.current.fingerprint !== fingerprint) this.invalid()
      return this.current.task
    }
    this.validateNext(sequence)
    const record = { sequence, fingerprint, settled: false, task: Promise.resolve().then(commit) }
    this.current = record
    void record.task.then(
      () => {
        record.settled = true
      },
      () => {
        record.settled = true
      }
    )
    return record.task
  }

  settle(sequence: number): Promise<FileWriteOutcome> {
    if (this.current?.sequence === sequence) return this.current.task
    this.validateNext(sequence)
    const outcome: FileWriteOutcome = { kind: 'not-started', sequence }
    this.current = { sequence, settled: true, task: Promise.resolve(outcome) }
    return this.current.task
  }

  async drain(): Promise<void> {
    await this.current?.task
  }

  private validateNext(sequence: number): void {
    if (
      !Number.isSafeInteger(sequence) ||
      sequence !== (this.current?.sequence ?? 0) + 1 ||
      this.current?.settled === false
    ) {
      this.invalid()
    }
  }

  private invalid(): never {
    throw new IpcError(fileErrorCodes.EDIT_INVALID_SEQUENCE, 'Invalid file edit write sequence')
  }
}
