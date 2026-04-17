import { PlusOutlined } from '@ant-design/icons'
import { Button, Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import Artboard, { type ArtboardProps } from '../../components/Artboard'
import PaintingPromptBar from '../../components/PaintingPromptBar'
import PaintingsList from '../../components/PaintingsList'
import type { PaintingData } from '../../model/types/paintingData'
import type { UsePaintingWorkspaceReturn } from '../hooks/usePaintingWorkspace'

export interface PaintingWorkspaceShellProps {
  pageState: UsePaintingWorkspaceReturn<any>
  sidebarContent: React.ReactNode
  onGenerate: () => Promise<void>
  modeTabs?: {
    options: Array<{ label: string; value: string }>
    value: string
    onChange: (value: string) => void
  }
  artboardProps?: Partial<ArtboardProps>
  centerContent?: React.ReactNode
  showTranslate?: boolean
  promptPlaceholder?: string
  promptDisabled?: boolean
}

const PaintingWorkspaceShell: FC<PaintingWorkspaceShellProps> = ({
  pageState,
  sidebarContent,
  onGenerate,
  modeTabs,
  artboardProps,
  centerContent,
  showTranslate,
  promptPlaceholder,
  promptDisabled
}) => {
  const { t } = useTranslation()

  const {
    painting,
    paintings,
    currentImageIndex,
    isLoading,
    isTranslating,
    fallbackUrls,
    patchPainting,
    onSelectPainting,
    onDeletePainting,
    handleAddPainting,
    prevImage,
    nextImage,
    onCancel,
    handleKeyDown,
    reorder
  } = pageState

  return (
    <div className="flex h-full flex-1 flex-col">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('paintings.title')}</NavbarCenter>
        {isMac && (
          <NavbarRight style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" className="nodrag" onClick={handleAddPainting}>
              <PlusOutlined />
              {t('paintings.button.new.image')}
            </Button>
          </NavbarRight>
        )}
      </Navbar>
      <div id="content-container" className="flex h-full flex-1 flex-row overflow-hidden bg-[var(--color-background)]">
        <Scrollbar className="flex h-full max-w-[var(--assistants-width)] flex-1 flex-col border-[var(--color-border)] border-r bg-[var(--color-background)] p-5">
          {sidebarContent}
        </Scrollbar>
        <div className="flex h-full flex-1 flex-col bg-[var(--color-background)]">
          {modeTabs && (
            <div className="flex justify-center pt-6">
              <Tabs value={modeTabs.value} onValueChange={modeTabs.onChange}>
                <TabsList>
                  {modeTabs.options.map((option) => (
                    <TabsTrigger key={option.value} value={option.value}>
                      {option.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          )}
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
          <PaintingPromptBar
            prompt={painting.prompt || ''}
            disabled={promptDisabled ?? isLoading}
            placeholder={
              promptPlaceholder ?? (isTranslating ? t('paintings.translating') : t('paintings.prompt_placeholder'))
            }
            onPromptChange={(value) => patchPainting({ prompt: value })}
            onGenerate={onGenerate}
            onKeyDown={showTranslate ? handleKeyDown : undefined}
          />
        </div>
        <PaintingsList
          paintings={paintings as PaintingData[]}
          selectedPainting={painting as PaintingData}
          onSelectPainting={onSelectPainting}
          onDeletePainting={onDeletePainting}
          onNewPainting={handleAddPainting}
          onReorder={reorder}
        />
      </div>
    </div>
  )
}

export default PaintingWorkspaceShell
