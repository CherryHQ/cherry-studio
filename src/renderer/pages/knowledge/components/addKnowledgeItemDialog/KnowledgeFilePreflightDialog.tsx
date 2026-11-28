import { useTranslation } from 'react-i18next'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { KNOWLEDGE_FORMATS, type KnowledgeFilePreflight } from '@shared/data/presets/knowledgeFormats'

const REASON_KEYS = {
  ok: 'knowledge.preflight.reason.ok',
  unsupported_format: 'knowledge.preflight.reason.unsupported_format',
  unreadable_file: 'knowledge.preflight.reason.unreadable_file',
  size_limit: 'knowledge.preflight.reason.size_limit',
  page_limit: 'knowledge.preflight.reason.page_limit',
  processor_not_configured: 'knowledge.preflight.reason.processor_not_configured',
  ocr_required: 'knowledge.preflight.reason.ocr_required',
  parser_unavailable: 'knowledge.preflight.reason.parser_unavailable'
} as const
const READER_KEYS: Record<string, string> = {
  text: 'knowledge.preflight.reader.text',
  html: 'knowledge.preflight.reader.html',
  csv: 'knowledge.preflight.reader.csv',
  pdf: 'knowledge.preflight.reader.pdf',
  anydoc: 'knowledge.preflight.reader.anydoc',
  drafts: 'knowledge.preflight.reader.drafts'
}

interface Props {
  results: KnowledgeFilePreflight[] | null
  blockPartial?: boolean
  onContinue: () => void
  onCancel: () => void
  onConfigure: () => void
}

export function KnowledgeFilePreflightDialog({
  results,
  onContinue,
  onCancel,
  onConfigure,
  blockPartial = false
}: Props) {
  const { t } = useTranslation()
  const passing = results?.filter((file) => file.reason === 'ok').length ?? 0
  return (
    <Dialog
      open={results !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}>
      <DialogContent size="lg" className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle>{t('knowledge.preflight.title')}</DialogTitle>
          <DialogDescription>{t('knowledge.preflight.description')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto">
          <ul className="space-y-2" aria-label={t('knowledge.preflight.files')}>
            {results?.map((file, index) => (
              <li key={`${file.path}-${index}`} className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium break-all">{file.path}</p>
                <p className={file.reason === 'ok' ? 'text-muted-foreground' : 'text-destructive'}>
                  {t(REASON_KEYS[file.reason])}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('knowledge.preflight.processor')}:{' '}
                  {READER_KEYS[file.processor] ? t(READER_KEYS[file.processor]) : file.processor}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('knowledge.preflight.limits', {
                    size:
                      file.maxInputBytes === undefined
                        ? t('knowledge.preflight.no_limit')
                        : `< ${file.maxInputBytes.toLocaleString()} B`,
                    pages: file.maxInputPages ?? t('knowledge.preflight.no_limit')
                  })}
                </p>
                {file.pageCount !== undefined && (
                  <p className="text-xs text-muted-foreground">
                    {t('knowledge.preflight.pages', { count: file.pageCount })}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">{t('knowledge.preflight.formats')}</summary>
            <p className="my-2 text-xs text-muted-foreground">{t('knowledge.preflight.matrix_note')}</p>
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th className="p-2">{t('knowledge.preflight.formats')}</th>
                  <th className="p-2">{t('knowledge.preflight.processor')}</th>
                </tr>
              </thead>
              <tbody>
                {KNOWLEDGE_FORMATS.map((format) => (
                  <tr key={format.reader} className="border-t border-border">
                    <td className="p-2 break-words">{format.extensions.join(', ')}</td>
                    <td className="p-2">{t(READER_KEYS[format.reader])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onConfigure}>
            {t('knowledge.preflight.configure')}
          </Button>
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={
              passing === 0 ||
              (blockPartial && results?.some((file) => file.reason !== 'ok' && file.reason !== 'unsupported_format'))
            }
            onClick={onContinue}>
            {t('knowledge.preflight.continue', { count: passing })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
