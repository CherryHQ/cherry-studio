import { afterAll } from 'vitest'

import type { DirectoryTreeOptions } from '@shared/utils/file'

import { FileObservationService } from '../../observation/FileObservationService'
import { createDirectoryTree } from '../builder'

const observations = new FileObservationService()
afterAll(() => observations._doStop())

export function createObservedDirectoryTree(root: string, options?: DirectoryTreeOptions) {
  return createDirectoryTree(root, options, observations)
}
