import fsp from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import type { BackupManifest, ValidationOptions, ValidationResult } from '@shared/backup'
import { BACKUP_MANIFEST_VERSION, ValidationErrorCode } from '@shared/backup'
import StreamZip from 'node-stream-zip'

import { hashFile } from '../utils/checksum'

const logger = loggerService.withContext('BackupValidator')

export class BackupValidatorImpl {
  async validate(zipPath: string, options?: ValidationOptions): Promise<ValidationResult> {
    const startTime = Date.now()
    const errors: ValidationResult['errors'] = []
    const warnings: ValidationResult['warnings'] = []
    const filesValidated: string[] = []

    let manifest: BackupManifest | null = null

    try {
      manifest = await this.readManifest(zipPath)
    } catch {
      errors.push({
        code: ValidationErrorCode.MANIFEST_MISSING,
        message: 'Failed to read manifest.json from backup archive'
      })
      return { valid: false, errors, warnings, duration: Date.now() - startTime, filesValidated, recordsValidated: 0 }
    }

    if (options?.checkManifest !== false) {
      this.validateManifest(manifest, errors, warnings)
    }

    if (options?.checkFiles !== false) {
      await this.validateChecksums(zipPath, manifest, errors, filesValidated)
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      duration: Date.now() - startTime,
      filesValidated,
      recordsValidated: 0
    }
  }

  async readManifest(zipPath: string): Promise<BackupManifest> {
    const zip = new StreamZip.async({ file: zipPath })
    try {
      const data = await zip.entryData('manifest.json')
      return JSON.parse(data.toString('utf-8')) as BackupManifest
    } finally {
      await zip.close()
    }
  }

  private validateManifest(
    manifest: BackupManifest,
    errors: ValidationResult['errors'],
    warnings: ValidationResult['warnings']
  ): void {
    if (manifest.version > BACKUP_MANIFEST_VERSION) {
      errors.push({
        code: ValidationErrorCode.COMPAT_VERSION_TOO_NEW,
        message: `Backup version ${manifest.version} is newer than supported version ${BACKUP_MANIFEST_VERSION}`,
        expected: BACKUP_MANIFEST_VERSION,
        actual: manifest.version
      })
    } else if (manifest.version < BACKUP_MANIFEST_VERSION) {
      warnings.push({
        code: ValidationErrorCode.COMPAT_VERSION_TOO_OLD,
        message: `Backup version ${manifest.version} is older than current version ${BACKUP_MANIFEST_VERSION}`,
        expected: BACKUP_MANIFEST_VERSION,
        actual: manifest.version
      })
    }

    if (!manifest.domains || manifest.domains.length === 0) {
      errors.push({
        code: ValidationErrorCode.MANIFEST_CORRUPTED,
        message: 'Backup manifest has no domains listed'
      })
    }
  }

  private async validateChecksums(
    zipPath: string,
    manifest: BackupManifest,
    errors: ValidationResult['errors'],
    filesValidated: string[]
  ): Promise<void> {
    const zip = new StreamZip.async({ file: zipPath })
    try {
      const tempDir = await fsp.mkdtemp(path.join(application.getPath('feature.backup.temp'), '.validate-'))
      try {
        await zip.extract(null, tempDir)

        const checksumsPath = path.join(tempDir, 'checksums.json')
        let checksums: Record<string, string> = {}
        try {
          const raw = await fsp.readFile(checksumsPath, 'utf-8')
          checksums = JSON.parse(raw)
        } catch {
          if (manifest.checksums) {
            checksums = manifest.checksums
          }
        }

        for (const [filePath, expectedHash] of Object.entries(checksums)) {
          const fullPath = path.join(tempDir, filePath)
          try {
            const actualHash = await hashFile(fullPath)
            filesValidated.push(filePath)
            if (actualHash !== expectedHash) {
              errors.push({
                code: ValidationErrorCode.FILE_HASH_MISMATCH,
                message: `Checksum mismatch for ${filePath}`,
                filePath,
                expected: expectedHash,
                actual: actualHash
              })
            }
          } catch {
            errors.push({
              code: ValidationErrorCode.FILE_MISSING,
              message: `File listed in checksums not found: ${filePath}`,
              filePath
            })
          }
        }
      } finally {
        await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {})
      }
    } finally {
      await zip.close()
    }

    logger.info('Checksum validation complete', {
      validated: filesValidated.length,
      errors: errors.length
    })
  }
}
