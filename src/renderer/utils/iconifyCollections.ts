import { addCollection, type IconifyJSON } from '@iconify/react'
import materialIconThemeIcons from '@iconify-json/material-icon-theme/icons.json'

import { FILE_ICON_NAMES } from './fileIconName'

const MATERIAL_FILE_ICON_NAMES = ['folder-other', 'folder-other-open', ...FILE_ICON_NAMES]

let collectionsRegistered = false

export function createMaterialFileIconCollection(): IconifyJSON {
  const icons: IconifyJSON['icons'] = {}

  for (const iconName of MATERIAL_FILE_ICON_NAMES) {
    const icon = materialIconThemeIcons.icons[iconName]
    if (icon) {
      icons[iconName] = icon
    }
  }

  return {
    prefix: materialIconThemeIcons.prefix,
    icons,
    width: materialIconThemeIcons.width,
    height: materialIconThemeIcons.height
  }
}

export function registerIconifyCollections() {
  if (collectionsRegistered) return

  addCollection(createMaterialFileIconCollection())
  collectionsRegistered = true
}
