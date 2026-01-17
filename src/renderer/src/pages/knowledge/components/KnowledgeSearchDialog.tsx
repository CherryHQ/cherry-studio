import { Button, Dialog, DialogContent, InputGroup, InputGroupAddon, InputGroupInput, Spinner } from '@cherrystudio/ui'
import { CircleX, Copy, Search } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { useKnowledgeSearchDialog } from '../hooks/useKnowledgeSearchDialog'

interface KnowledgeSearchDialogProps {
  baseId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const KnowledgeSearchDialog: FC<KnowledgeSearchDialogProps> = ({ baseId, open, onOpenChange }) => {
  const { t } = useTranslation()
  const {
    searchKeyword,
    setSearchKeyword,
    results,
    isSearching,
    handleSearch,
    handleCopy,
    handleSourceClick,
    getSourceText,
    reset
  } = useKnowledgeSearchDialog({ baseId })

  const onClose = () => {
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className="flex h-[min(550px,70vh)] flex-col gap-0 overflow-hidden p-2 sm:max-w-[min(700px,70vw)]"
        showCloseButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()}>
        <InputGroup className="rounded-none border-0 px-2 py-0 shadow-none focus-within:border-0! focus-within:ring-0!">
          <InputGroupAddon className="p-0">
            <Search size={15} />
          </InputGroupAddon>
          <InputGroupInput
            value={searchKeyword}
            placeholder={t('knowledge.search')}
            autoFocus
            spellCheck={false}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch(searchKeyword)}
          />
          {searchKeyword && (
            <InputGroupAddon
              align="inline-end"
              className="cursor-pointer items-center justify-center rounded-full p-0 hover:opacity-70"
              onClick={reset}>
              <CircleX />
            </InputGroupAddon>
          )}
        </InputGroup>

        <div className="flex-1 overflow-y-auto px-2">
          {isSearching ? (
            <div className="flex h-full items-center justify-center">
              <Spinner text={t('common.loading')} />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {results.map((item, index) => (
                <div key={index} className="py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className="cursor-pointer text-primary hover:opacity-70"
                      onClick={() => handleSourceClick(item)}>
                      {t('knowledge.source')}: {getSourceText(item)}
                    </div>
                    {item.score !== 0 && (
                      <div className="rounded-3xs border border-primary/40 bg-primary/5 px-2 text-primary text-xs">
                        {t('knowledge.relevance')}: {(item.score * 100).toFixed(1)}%
                      </div>
                    )}
                  </div>
                  <div className="flex items-start">
                    <p className="mb-0 flex-1 select-text">{item.pageContent}</p>
                    <Button
                      className="p-0 shadow-none hover:opacity-70"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleCopy(item.pageContent)}>
                      <Copy />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default KnowledgeSearchDialog
