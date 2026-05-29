/**
 * `DirectoryTreeBuilder` — runtime primitive of the file module.
 *
 * Architecture SoT: `docs/references/file/directory-tree.md`. (The earlier
 * draft at `v2-refactor-temp/docs/file-manager/rfc-file-manager.md §12` is
 * superseded.)
 *
 * Exports the factory `createDirectoryTree(rootPath, options)` and the
 * `TreeNode` class hierarchy. The renderer-facing surface is the
 * `File_Tree*` IPC contract owned by `DirectoryTreeManager.ts` in this
 * same directory; main-side business modules can use the factory directly.
 *
 * DB isolation is a hard rule (directory-tree.md §2.2): this module never
 * imports from `@main/data/**`. Enforcement is the import-graph regex test
 * in `__tests__/builder.test.ts` ("the tree primitive does not import
 * @main/data") — there is no ESLint `no-restricted-imports` rule wiring
 * for it today; the test is the contract.
 */

export { createDirectoryTree, type DirectoryTreeBuilder } from './builder'
// The class hierarchy lives in shared so the renderer hook can build the
// same node objects from the IPC snapshot without a separate mirror — see
// `src/shared/file/types/tree.ts`.
export { rootFromSerialized, TreeDir, TreeDirRoot, TreeFile, TreeNode } from '@shared/file/types'
