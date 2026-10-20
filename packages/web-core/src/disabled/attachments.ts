// Stand-ins for `ai/messages/attachmentTextExtraction` and `ai/messages/fileProcessor`:
// the trial chat does not accept attachments.
import { unsupported } from './unsupported'

export const extractDocumentText = unsupported('Chat attachments')
export const noExtractableTextNote = unsupported('Chat attachments')
export const materializeNativeFilePart = unsupported('Chat attachments')
