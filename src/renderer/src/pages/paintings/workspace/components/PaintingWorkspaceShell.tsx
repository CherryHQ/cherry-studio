import '../painting-workspace-scope.css'

import { Button, Tabs, TabsList, TabsTrigger, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { SlidersHorizontal, X } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import Artboard, { type ArtboardProps } from '../../components/Artboard'
import PaintingPromptBar from '../../components/PaintingPromptBar'
import type { PaintingHistoryItem } from '../hooks/usePaintingHistoryStrip'
import type { UsePaintingWorkspaceReturn } from '../hooks/usePaintingWorkspace'
import { paintingWorkspaceClasses } from '../PaintingWorkspacePrimitives'
import PaintingHistoryStrip from './PaintingHistoryStrip'

export interface PaintingWorkspaceShellProps {
  pageState: UsePaintingWorkspaceReturn<any>
  sidebarContent: React.ReactNode
  onGenerate: () => Promise<void>
  onSelectHistoryPainting: (painting: PaintingHistoryItem) => void
  modeTabs?: {
    options: Array<{ label: string; value: string }>
    value: string
    onChange: (value: string) => void
  }
  artboardProps?: Partial<ArtboardProps>
  centerContent?: React.ReactNode
  promptModelSelector?: React.ReactNode
  showTranslate?: boolean
  promptPlaceholder?: string
  promptDisabled?: boolean
}

const PaintingWorkspaceShell: FC<PaintingWorkspaceShellProps> = ({
  pageState,
  sidebarContent,
  onGenerate,
  onSelectHistoryPainting,
  modeTabs,
  artboardProps,
  centerContent,
  promptModelSelector,
  showTranslate,
  promptPlaceholder,
  promptDisabled
}) => {
  const { t } = useTranslation()
  const [isParametersOpen, setIsParametersOpen] = useState(true)

  const {
    painting,
    currentImageIndex,
    isLoading,
    isTranslating,
    fallbackUrls,
    patchPainting,
    onDeletePainting,
    handleAddPainting,
    prevImage,
    nextImage,
    onCancel,
    handleKeyDown
  } = pageState

  return (
    <div className={paintingWorkspaceClasses.shell}>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('paintings.title')}</NavbarCenter>
      </Navbar>
      <div id="content-container" className={paintingWorkspaceClasses.content}>
        <div className="flex h-full flex-1 flex-col bg-white dark:bg-background">
          <div className={paintingWorkspaceClasses.workspaceFrame}>
            <div className={paintingWorkspaceClasses.workspaceSurface}>
              <div
                className={cn(
                  paintingWorkspaceClasses.panel,
                  isParametersOpen ? paintingWorkspaceClasses.panelVisible : paintingWorkspaceClasses.panelHidden
                )}>
                <div className={paintingWorkspaceClasses.panelHeader}>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-foreground text-xs tracking-wider">{t('common.settings')}</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 rounded-full text-muted-foreground"
                    onClick={() => setIsParametersOpen(false)}>
                    <X className="size-3.5" />
                  </Button>
                </div>
                <div className={paintingWorkspaceClasses.panelBody}>
                  <Scrollbar className={paintingWorkspaceClasses.panelScroll}>{sidebarContent}</Scrollbar>
                </div>
              </div>
              <div className={paintingWorkspaceClasses.centerPane}>
                {centerContent ? (
                  centerContent
                ) : (
                  <Artboard
                    painting={painting}
                    isLoading={isLoading}
                    currentImageIndex={currentImageIndex}
                    fallbackUrls={fallbackUrls}
                    onPrevImage={prevImage}
                    onNextImage={nextImage}
                    onCancel={onCancel}
                    {...artboardProps}
                  />
                )}
              </div>
              <PaintingHistoryStrip
                selectedPaintingId={painting.id}
                onDeletePainting={onDeletePainting}
                onSelectPainting={onSelectHistoryPainting}
                onAddPainting={handleAddPainting}
              />
            </div>
          </div>
          <PaintingPromptBar
            prompt={painting.prompt || ''}
            disabled={promptDisabled ?? isLoading}
            leadingActions={
              <>
                <Tooltip content={t('common.settings')} delay={500}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={paintingWorkspaceClasses.promptSettingButton}
                    aria-label={t('common.settings')}
                    onClick={() => setIsParametersOpen((open) => !open)}>
                    <SlidersHorizontal className="size-3.5" />
                  </Button>
                </Tooltip>
                {modeTabs && (
                  <Tabs value={modeTabs.value} onValueChange={modeTabs.onChange}>
                    <TabsList className={paintingWorkspaceClasses.promptModeTabsList}>
                      {modeTabs.options.map((option) => (
                        <TabsTrigger
                          key={option.value}
                          value={option.value}
                          className={cn(paintingWorkspaceClasses.promptModeTabsTrigger)}>
                          {option.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                )}
              </>
            }
            modelSelector={promptModelSelector}
            placeholder={
              promptPlaceholder ?? (isTranslating ? t('paintings.translating') : t('paintings.prompt_placeholder'))
            }
            onPromptChange={(value) => patchPainting({ prompt: value })}
            onGenerate={onGenerate}
            onKeyDown={showTranslate ? handleKeyDown : undefined}
          />
        </div>
      </div>
    </div>
  )
}

export default PaintingWorkspaceShell
