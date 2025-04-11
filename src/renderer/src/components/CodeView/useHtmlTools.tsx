import { AppLogo } from '@renderer/config/env'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { extractTitle } from '@renderer/utils/formats'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { ToolContext } from './context'

export const useHtmlHandlers = () => {
  const { t } = useTranslation()
  const { openMinapp } = useMinappPopup()

  /**
   * 在应用内打开
   */
  const handleOpenInApp = useCallback(
    async (ctx?: ToolContext) => {
      if (!ctx) return
      const { code } = ctx

      const title = extractTitle(code) || 'Artifacts ' + t('chat.artifacts.button.preview')
      const path = await window.api.file.create('artifacts-preview.html')
      await window.api.file.write(path, code)
      const filePath = `file://${path}`
      openMinapp({
        id: 'artifacts-preview',
        name: title,
        logo: AppLogo,
        url: filePath
      })
    },
    [t, openMinapp]
  )

  /**
   * 外部链接打开
   */
  const handleOpenExternal = useCallback(
    async (ctx?: ToolContext) => {
      if (!ctx) return

      const path = await window.api.file.create('artifacts-preview.html')
      await window.api.file.write(path, ctx.code)
      const filePath = `file://${path}`

      if (window.api.shell && window.api.shell.openExternal) {
        window.api.shell.openExternal(filePath)
      } else {
        console.error(t('artifacts.preview.openExternal.error.content'))
      }
    },
    [t]
  )

  return { handleOpenInApp, handleOpenExternal }
}
