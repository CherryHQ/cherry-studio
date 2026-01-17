import { Badge, Button, CustomTag, RowFlex, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useKnowledgeBase, useKnowledgeItems } from '@renderer/data/hooks/useKnowledges'
import { usePreprocessProviders } from '@renderer/hooks/usePreprocess'
import { NavbarIcon } from '@renderer/pages/home/ChatNavbar'
import { getProviderName } from '@renderer/services/ProviderService'
import { PlusIcon, RefreshCw, Search, Settings } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import EditKnowledgeBaseDialog from './components/EditKnowledgeBaseDialog'
import KnowledgeSearchDialog from './components/KnowledgeSearchDialog'
import QuotaTag from './components/QuotaTag'
import { useKnowledgeAddActions } from './hooks/useKnowledgeAddActions'
import { useKnowledgeProgress } from './hooks/useKnowledgeProgress'
import { useKnowledgeQueueActions } from './hooks/useKnowledgeQueueActions'
import { type TabKey, useKnowledgeTabs } from './hooks/useKnowledgeTabs'
import { mapKnowledgeBaseV2ToV1 } from './utils/knowledgeBaseAdapter'

const logger = loggerService.withContext('KnowledgeContent')
interface KnowledgeContentProps {
  selectedBaseId: string
}

const KnowledgeContent: FC<KnowledgeContentProps> = ({ selectedBaseId }) => {
  const { t } = useTranslation()
  const { base: baseV2 } = useKnowledgeBase(selectedBaseId, { enabled: !!selectedBaseId })
  const { items } = useKnowledgeItems(selectedBaseId, { enabled: !!selectedBaseId })
  const { preprocessProviders } = usePreprocessProviders()
  const base = useMemo(
    () => (baseV2 ? mapKnowledgeBaseV2ToV1(baseV2, preprocessProviders) : undefined),
    [baseV2, preprocessProviders]
  )
  const { quota, progressMap, preprocessMap } = useKnowledgeProgress()
  const { hasOrphans, orphanCount, handleRecover, handleIgnore, isRecovering, isIgnoring } =
    useKnowledgeQueueActions(selectedBaseId)
  const { activeKey, setActiveKey, tabItems } = useKnowledgeTabs({
    base: base ?? null,
    items,
    progressMap,
    preprocessMap
  })

  // Add actions for the current tab
  const addActions = useKnowledgeAddActions({ base: base ?? null })
  const currentAction = addActions[activeKey as TabKey]
  const currentTab = tabItems.find((t) => t.key === activeKey)

  // Edit dialog state (independent from sidebar's edit dialog)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  // Search dialog state
  const [searchDialogOpen, setSearchDialogOpen] = useState(false)

  const providerName = getProviderName(base?.model)

  const handleMigrateV2 = useCallback(async () => {
    if (!base || base.version !== 1) return
    try {
      const result = await window.api.knowledgeBase.migrateV2(base)
      if (result.success) {
        window.toast.success(t('knowledge.migrate_v2_success'))
      } else {
        window.toast.error(result.error || t('knowledge.migrate_v2_failed'))
      }
    } catch (error) {
      window.toast.error(t('knowledge.migrate_v2_failed'))
      logger.error('Migration failed:', error as Error)
    }
  }, [base, t])

  if (!base) {
    return null
  }

  return (
    <MainContainer>
      <HeaderContainer>
        <ModelInfo>
          <Button variant="ghost" size="icon-sm" onClick={() => setEditDialogOpen(true)}>
            <Settings size={18} color="var(--color-icon)" />
          </Button>
          <div className="model-row">
            <div className="label-column">
              <label>{t('models.embedding_model')}</label>
            </div>
            <Tooltip placement="bottom" content={providerName}>
              <div className="tag-column">
                <Badge>{base.model.name}</Badge>
              </div>
            </Tooltip>
            {base.rerankModel && <Badge>{base.rerankModel.name}</Badge>}
            {base.preprocessProvider && base.preprocessProvider.type === 'preprocess' && (
              <QuotaTag base={base} providerId={base.preprocessProvider?.provider.id} quota={quota} />
            )}
          </div>
        </ModelInfo>
        <RowFlex className="items-center gap-2">
          {hasOrphans && (
            <>
              <Button variant="outline" size="sm" onClick={handleRecover} disabled={isRecovering || isIgnoring}>
                <RefreshCw size={14} className={isRecovering ? 'animate-spin' : ''} />
                {t('knowledge.recover_orphans', { count: orphanCount })}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleIgnore} disabled={isRecovering || isIgnoring}>
                {t('knowledge.ignore_orphans')}
              </Button>
            </>
          )}
          {base.version === 1 && (
            <Button variant="outline" size="sm" onClick={handleMigrateV2}>
              <RefreshCw size={14} />
              {t('knowledge.migrate_v2')}
            </Button>
          )}
          {/* 使用selected base导致修改设置后没有响应式更新 */}
          <NavbarIcon onClick={() => setSearchDialogOpen(true)}>
            <Search size={18} />
          </NavbarIcon>
        </RowFlex>
      </HeaderContainer>
      <Tabs value={activeKey} onValueChange={(v) => setActiveKey(v as TabKey)} variant="line" className="flex-1">
        <div className="mx-4 flex h-12 items-center justify-between border-b-0 bg-transparent p-0">
          <TabsList className="h-full justify-start gap-1 bg-transparent p-0">
            {tabItems.map((item) => (
              <TabsTrigger key={item.key} value={item.key} className="gap-1.5 px-3 py-3 text-[13px]">
                {item.icon}
                <span>{item.title}</span>
                <div></div>
                <CustomTag size={10} color={item.items.length > 0 ? '#00b96b' : '#cccccc'}>
                  {item.items.length}
                </CustomTag>
              </TabsTrigger>
            ))}
          </TabsList>
          <Button
            className="h-8 rounded-2xs"
            size="sm"
            variant="outline"
            onClick={currentAction?.handler}
            disabled={currentAction?.disabled || currentAction?.loading}>
            <PlusIcon className="text-primary" />
            {currentTab?.addButtonLabel}
          </Button>
        </div>
        {tabItems.map((item) => (
          <TabsContent key={item.key} value={item.key} className="h-full overflow-hidden">
            {item.content}
          </TabsContent>
        ))}
      </Tabs>

      {/* Edit Dialog */}
      <EditKnowledgeBaseDialog baseId={base.id} open={editDialogOpen} onOpenChange={setEditDialogOpen} />
      {/* Search Dialog */}
      <KnowledgeSearchDialog baseId={base.id} open={searchDialogOpen} onOpenChange={setSearchDialogOpen} />
    </MainContainer>
  )
}

const MainContainer = styled.div`
  display: flex;
  width: 100%;
  flex-direction: column;
  position: relative;
`

const HeaderContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 16px;
  border-bottom: 0.5px solid var(--color-border);
`

const ModelInfo = styled.div`
  display: flex;
  color: var(--color-text-3);
  flex-direction: row;
  align-items: center;
  gap: 8px;
  height: 45px;

  .model-header {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .model-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .label-column {
    flex-shrink: 0;
  }

  .tag-column {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }

  label {
    color: var(--color-text-2);
  }
`

export default KnowledgeContent
