import { Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
import type { KnowledgeTabKey } from '@renderer/pages/knowledge.v2/types'
import { Database, SlidersHorizontal, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface DetailTabsProps {
  activeTab: KnowledgeTabKey
  dataSourceCount: number
  onChange: (value: KnowledgeTabKey) => void
}

const DetailTabs = ({ activeTab, dataSourceCount, onChange }: DetailTabsProps) => {
  const { t } = useTranslation()

  return (
    <div className="shrink-0 border-border/15 border-b px-2.5">
      <Tabs
        value={activeTab}
        onValueChange={(value) => onChange(value as KnowledgeTabKey)}
        variant="line"
        className="gap-0">
        <TabsList className="gap-0">
          <TabsTrigger
            value="data"
            className="gap-1 px-2.5 py-2 text-[0.625rem] text-muted-foreground/60 leading-3.75 after:h-0.5 after:rounded-none after:bg-transparent hover:text-foreground data-[state=active]:text-foreground data-[state=active]:after:h-0.5 data-[state=active]:after:bg-primary">
            <Database className="size-3" />
            <span>{t('knowledge_v2.tabs.data_source')}</span>
            <span>{dataSourceCount}</span>
          </TabsTrigger>

          <TabsTrigger
            value="rag"
            className="gap-1 px-2.5 py-2 text-[0.625rem] text-muted-foreground/60 leading-3.75 after:h-0.5 after:rounded-none after:bg-transparent hover:text-foreground data-[state=active]:text-foreground data-[state=active]:after:h-0.5 data-[state=active]:after:bg-primary">
            <SlidersHorizontal className="size-3" />
            <span>{t('knowledge_v2.tabs.rag_config')}</span>
          </TabsTrigger>

          <TabsTrigger
            value="recall"
            className="gap-1 px-2.5 py-2 text-[0.625rem] text-muted-foreground/60 leading-3.75 after:h-0.5 after:rounded-none after:bg-transparent hover:text-foreground data-[state=active]:text-foreground data-[state=active]:after:h-0.5 data-[state=active]:after:bg-primary">
            <Zap className="size-3" />
            <span>{t('knowledge_v2.tabs.recall_test')}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  )
}

export default DetailTabs
