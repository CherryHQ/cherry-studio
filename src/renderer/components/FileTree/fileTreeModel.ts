import { FileTree as FileTreeModel, type FileTreeOptions } from '@pierre/trees'

import {
  FILE_TREE_ICON_BY_FILE_EXTENSION,
  FILE_TREE_ICON_BY_FILE_NAME,
  FILE_TREE_ICON_REMAP,
  FILE_TREE_ICON_SPRITE
} from './iconSprite.generated'
import { FILE_TREE_ITEM_HEIGHT } from './treeTheme'

export type { FileTreeOptions }
export { FileTreeModel }

/**
 * Behaviour the caller owns; presentation is applied here so it can't drift per
 * call site. Distributed over the union so the library's "paths or preparedInput,
 * at least one" constraint survives the `Omit`.
 */
export type CreateFileTreeModelOptions = FileTreeOptions extends infer TOption
  ? TOption extends FileTreeOptions
    ? Omit<TOption, 'icons' | 'itemHeight' | 'search'>
    : never
  : never

/**
 * Creates a tree model with our icon set and row metrics applied.
 *
 * **The caller owns this instance's lifetime.** Do not reach for `useFileTree()`:
 * it tears the model down from an effect cleanup, and `<Activity mode="hidden">`
 * runs those on every right-pane close and tab switch — which is exactly the
 * rebuild churn this component exists to avoid. Construct the model above the
 * `<Activity>` boundary and call `cleanUp()` only when its root really goes away;
 * `<FileTree>` unmounting just calls `unmount()`, which keeps the model alive.
 *
 * `search: false` suppresses the library's own search field — callers render our
 * Tailwind one and drive filtering with `model.setSearch(...)`, which is not
 * gated by that flag.
 */
export function createFileTreeModel(options: CreateFileTreeModelOptions): FileTreeModel {
  return new FileTreeModel({
    ...options,
    search: false,
    itemHeight: FILE_TREE_ITEM_HEIGHT,
    icons: {
      // Built-in file-type mappings off — every icon comes from the generated
      // material-icon-theme sprite so the look survived the migration.
      set: 'none',
      spriteSheet: FILE_TREE_ICON_SPRITE,
      remap: FILE_TREE_ICON_REMAP,
      byFileName: FILE_TREE_ICON_BY_FILE_NAME,
      byFileExtension: FILE_TREE_ICON_BY_FILE_EXTENSION
    }
  })
}
