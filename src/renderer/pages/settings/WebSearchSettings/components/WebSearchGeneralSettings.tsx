import type { FC } from 'react'

import BasicSettings from './BasicSettings'
import BlacklistSettings from './BlacklistSettings'

export const WebSearchGeneralSettings: FC = () => {
  return (
    <>
      <BasicSettings />
      <BlacklistSettings />
    </>
  )
}
