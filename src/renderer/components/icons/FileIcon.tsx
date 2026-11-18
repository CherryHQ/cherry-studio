import { Icon, type IconProps } from '@iconify/react'

import { getFileIconName } from '@renderer/utils/fileIconName'

interface FileIconProps extends Omit<IconProps, 'icon'> {
  path: string
}

export function FileIcon({ path, ...props }: FileIconProps) {
  return <Icon {...props} icon={`material-icon-theme:${getFileIconName(path)}`} />
}
