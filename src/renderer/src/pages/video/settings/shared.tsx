import { Divider } from '@heroui/react'
import type { PropsWithChildren } from 'react'

export const SettingsGroup = ({ children }: PropsWithChildren) => {
  return <div className="mb-4 flex flex-col rounded-2xl border border-foreground-200 p-3">{children}</div>
}

export const SettingItem = ({ children, divider = false }: PropsWithChildren<{ divider?: boolean }>) => {
  return (
    <>
      <div className="mb-2">{children}</div>
      {divider && <Divider className="my-2" />}
    </>
  )
}
