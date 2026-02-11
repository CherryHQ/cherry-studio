import type { FC, ReactNode } from 'react'
import { Fragment } from 'react'

const GeneralSettingsRoot: FC<{ children: ReactNode }> = ({ children }) => {
  return <div className="flex w-full flex-col gap-1">{children}</div>
}

const GeneralSettingsSection: FC<{ children: ReactNode }> = ({ children }) => {
  return <Fragment>{children}</Fragment>
}

const GeneralSettingsDivider: FC = () => {
  return <div className="border-border border-b" />
}

export const GeneralSettingsLayout = Object.assign(GeneralSettingsRoot, {
  Section: GeneralSettingsSection,
  Divider: GeneralSettingsDivider
})
