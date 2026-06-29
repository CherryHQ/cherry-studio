import { officePreviewErrorCodes } from '@shared/ipc/errors/officePreview'
import { describe, expect, it } from 'vitest'

import { officePreviewService } from '../OfficePreviewService'

describe('OfficePreviewService', () => {
  it('rejects unsupported Office extensions before parsing', async () => {
    await expect(
      officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: 'proposal.docx' })
    ).rejects.toMatchObject({ code: officePreviewErrorCodes.UNSUPPORTED_EXTENSION })
  })

  it('rejects workspace-relative paths that traverse outside the workspace', async () => {
    await expect(
      officePreviewService.render({ workspacePath: '/tmp/workspace', filePath: '../secret.xlsx' })
    ).rejects.toMatchObject({ code: officePreviewErrorCodes.INVALID_REQUEST })
  })
})
