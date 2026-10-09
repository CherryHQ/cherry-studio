import { mkdir, mkdtemp, lstat, realpath, rm, rmdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { bestEffortUnlinkOwnedPath, publishFileNoClobber } from '@main/ai/tools/assistantFileSafety'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import type { ConvertedDocument } from './convertDocument'

const logger = loggerService.withContext('DocumentConversion')

export async function publishDocument(
  document: ConvertedDocument,
  outputPath: string,
  options: { signal?: AbortSignal; validateTarget?: () => Promise<void> } = {}
): Promise<void> {
  const temporaryDirectory = await mkdtemp(application.getPath('app.temp', 'document-conversion-'))
  let resources: { path: string; dev: number; ino: number } | undefined
  const publishedAssets: { path: string; dev: bigint; ino: bigint }[] = []
  let complete = false
  let validateResources: (() => Promise<void>) | undefined
  try {
    options.signal?.throwIfAborted()
    await options.validateTarget?.()
    if (document.resourceDirectory) {
      const resourcePath = path.join(path.dirname(outputPath), document.resourceDirectory)
      await mkdir(resourcePath)
      const identity = await lstat(resourcePath)
      resources = { path: resourcePath, dev: identity.dev, ino: identity.ino }
      const canonical = await realpath(resourcePath)
      validateResources = async () => {
        await options.validateTarget?.()
        const current = await lstat(resourcePath)
        if (
          !current.isDirectory() ||
          current.isSymbolicLink() ||
          current.dev !== identity.dev ||
          current.ino !== identity.ino ||
          (await realpath(resourcePath)) !== canonical
        )
          throw new Error('Document resource directory changed during conversion')
      }
      for (const [name, bytes] of document.assets) {
        await validateResources()
        const stagedAsset = AbsoluteFilePathSchema.parse(path.join(temporaryDirectory, name))
        await writeFile(stagedAsset, bytes, { flag: 'wx', signal: options.signal })
        const assetPath = AbsoluteFilePathSchema.parse(path.join(resourcePath, name))
        await publishFileNoClobber(stagedAsset, assetPath, {
          signal: options.signal,
          validateTarget: validateResources
        })
        const assetIdentity = await lstat(assetPath, { bigint: true })
        publishedAssets.push({ path: assetPath, dev: assetIdentity.dev, ino: assetIdentity.ino })
      }
      await validateResources()
    }
    const staged = AbsoluteFilePathSchema.parse(path.join(temporaryDirectory, 'document'))
    await writeFile(staged, document.bytes, { flag: 'wx', signal: options.signal })
    await publishFileNoClobber(staged, AbsoluteFilePathSchema.parse(outputPath), {
      ...options,
      validateTarget: validateResources ?? options.validateTarget
    })
    complete = true
  } finally {
    if (!complete && resources) {
      const identity = await lstat(resources.path).catch(() => undefined)
      if (identity?.dev === resources.dev && identity.ino === resources.ino) {
        for (const asset of publishedAssets)
          await bestEffortUnlinkOwnedPath(AbsoluteFilePathSchema.parse(asset.path), asset, 'publishDocument')
        await rmdir(resources.path).catch((error) =>
          logger.warn('Failed to remove incomplete document resources', error)
        )
      }
    }
    await rm(temporaryDirectory, { recursive: true, force: true }).catch((error) =>
      logger.warn('Failed to remove document staging directory', error)
    )
  }
}
