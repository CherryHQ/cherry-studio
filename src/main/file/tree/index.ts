/**
 * `DirectoryTreeBuilder` — RFC §12 runtime primitive.
 *
 * Exports the factory `createDirectoryTree(rootPath, options)` and the
 * `TreeNode` class hierarchy. The IPC bridge under
 * `src/main/services/file/FileManager.ts` (the `Tree_*` channels) is the
 * sole renderer-facing entry; main-side business modules can use the
 * factory directly.
 *
 * DB isolation is a hard rule (`file-manager-architecture.md` §12.6): this
 * module never imports from `@main/data/**`. ESLint enforces it via
 * `no-restricted-imports` in `eslint.config.js`.
 */

export { createDirectoryTree, type DirectoryTreeBuilder } from './builder'
// The class hierarchy lives in shared so the renderer hook can build the
// same node objects from the IPC snapshot without a separate mirror — see
// `packages/shared/file/types/tree.ts`.
export { fromSerialized, rootFromSerialized, TreeDir, TreeDirRoot, TreeFile, TreeNode } from '@shared/file/types'
