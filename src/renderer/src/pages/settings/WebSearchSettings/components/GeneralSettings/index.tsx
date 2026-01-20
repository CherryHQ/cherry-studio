import type { FC } from 'react'

import BasicSettings from './BasicSettings'
import BlacklistSettings from './BlacklistSettings'
import CompressionSettings from './CompressionSettings'

const WebSearchGeneralSettings: FC = () => {
  return (
    <div className="flex w-full flex-col gap-1">
      <BasicSettings />
      <div className="border-border border-b" />
      <CompressionSettings />
      <div className="border-border border-b" />
      <BlacklistSettings />
      <div className="border-border border-b" />
    </div>
  )
}

export default WebSearchGeneralSettings
