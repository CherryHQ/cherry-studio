import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { useCompressionMethod } from '@renderer/hooks/useWebSearch'
import type { WebSearchCompressionMethod } from '@shared/data/preference/preferenceTypes'
import { useTranslation } from 'react-i18next'

import { getCompressionRenderer } from './CompressionMethodRegistry'

const CompressionSettings = () => {
  const { t } = useTranslation()
  const { method, setMethod } = useCompressionMethod()

  const handleCompressionMethodChange = (method: WebSearchCompressionMethod) => {
    setMethod(method)
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-2">
      <div>{t('settings.tool.websearch.compression.title')}</div>
      <div className="border-border border-b" />

      <div className="flex flex-row items-center justify-between">
        <div>{t('settings.tool.websearch.compression.method.label')}</div>
        <Select value={method} onValueChange={handleCompressionMethodChange}>
          <SelectTrigger className={method === 'rag' ? 'w-[min(350px,60%)]' : 'w-50'}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('settings.tool.websearch.compression.method.none')}</SelectItem>
            <SelectItem value="cutoff">{t('settings.tool.websearch.compression.method.cutoff')}</SelectItem>
            <SelectItem value="rag">{t('settings.tool.websearch.compression.method.rag')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {getCompressionRenderer(method)}
    </div>
  )
}

export default CompressionSettings
