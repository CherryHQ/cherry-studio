import { Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
import type { KnowledgeTabKey } from '@renderer/pages/knowledge/types'
import { useTranslation } from 'react-i18next'

interface DetailTabsProps {
  activeTab: KnowledgeTabKey
  dataSourceCount: number
  onChange: (value: KnowledgeTabKey) => void
}

const DetailTabs = ({ activeTab, dataSourceCount, onChange }: DetailTabsProps) => {
  const { t } = useTranslation()

  return (
    <div className="shrink-0 border-border-muted border-b bg-background px-3 py-1.5">
      <Tabs value={activeTab} onValueChange={(value) => onChange(value as KnowledgeTabKey)} variant="workflow">
        <TabsList>
          <TabsTrigger value="data">
            <span>{t('knowledge.tabs.data_source')}</span>
            {dataSourceCount > 0 ? <span className="text-foreground-muted text-xs">({dataSourceCount})</span> : null}
          </TabsTrigger>

          <TabsTrigger value="rag">
            <span>{t('knowledge.tabs.rag_config')}</span>
          </TabsTrigger>

          <TabsTrigger value="recall">
            <span>{t('knowledge.tabs.recall_test')}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  )
}

export default DetailTabs
