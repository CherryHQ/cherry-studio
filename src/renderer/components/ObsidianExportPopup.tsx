import type { ObsidianProcessingMethod } from '@renderer/components/ObsidianExportDialog'
import { PopupContainer } from '@renderer/components/ObsidianExportDialog'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import type { ExportableMessage } from '@renderer/types/messageExport'
import type { Topic } from '@renderer/types/topic'

interface ObsidianExportOptions {
  title: string
  processingMethod: (typeof ObsidianProcessingMethod)[keyof typeof ObsidianProcessingMethod]
  topic?: Topic
  message?: ExportableMessage
  messages?: ExportableMessage[]
  rawContent?: string
}

const ObsidianExportPopupContainer: React.FC<ObsidianExportOptions & PopupInjectedProps<boolean>> = (props) => (
  <PopupContainer {...props} obsidianTags="" />
)

const ObsidianExportPopup = createPopup<ObsidianExportOptions, boolean>(ObsidianExportPopupContainer, {
  dismissResult: false
})

export default ObsidianExportPopup
