import materialIconTheme from '@iconify-json/material-icon-theme/icons.json'
import { addCollection, Icon, type IconProps } from '@iconify/react'

import { getFileIconName } from '@renderer/utils/fileIconName'

addCollection(materialIconTheme)

interface FileIconProps extends Omit<IconProps, 'icon'> {
  path: string
}

export function FileIcon({ path, ...props }: FileIconProps) {
  return <Icon {...props} icon={`material-icon-theme:${getFileIconName(path)}`} />
}
