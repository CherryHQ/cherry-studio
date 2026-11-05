import { LoaderCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { useIllustration } from '@renderer/hooks/useIllustration'
import type { IllustrationData, IllustrationTarget } from '@shared/data/types/illustration'

import { useMessageListActions } from '../MessageListProvider'
import MessageImageBlock from './MessageImageBlock'

const errorKeys = {
  configuration: 'chat.illustration.configuration',
  generation: 'chat.illustration.generation',
  incomplete: 'chat.illustration.incomplete',
  interrupted: 'chat.illustration.interrupted',
  invalid_references: 'chat.illustration.invalid_references',
  input_unsupported: 'chat.illustration.input_unsupported',
  input_limit: 'chat.illustration.input_limit',
  input_unavailable: 'chat.illustration.input_unavailable'
} as const

export default function MessageIllustrationBlock({
  target,
  data: initial
}: {
  target: IllustrationTarget
  data: IllustrationData
}) {
  const { t } = useTranslation()
  const data = useIllustration(target, initial)
  const { retryIllustration, cancelIllustration, notifyError } = useMessageListActions()
  const [busy, setBusy] = useState(false)
  const [promptExpanded, setPromptExpanded] = useState(false)
  const sources = useMemo(
    () =>
      (data.files ?? []).map((file) => ({
        handle: { kind: 'entry' as const, entryId: file.id },
        url: ''
      })),
    [data.files]
  )
  const canShowPrompt = !!data.prompt && data.error !== 'incomplete'
  const promptDisclosure = canShowPrompt && (
    <div className="w-full max-w-xl">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={promptExpanded}
        aria-controls={`illustration-prompt-${data.id}`}
        onClick={() => setPromptExpanded((expanded) => !expanded)}>
        {promptExpanded ? t('chat.illustration.hide_prompt') : t('chat.illustration.show_prompt')}
      </Button>
      {promptExpanded && (
        <div
          id={`illustration-prompt-${data.id}`}
          className="mt-1 max-h-96 overflow-auto rounded-md border bg-muted p-3 text-sm text-foreground">
          <pre className="whitespace-pre-wrap break-words">{data.prompt}</pre>
          {!!data.inputFiles?.length && (
            <div role="group" aria-label={t('chat.illustration.input_images')} className="mt-3 flex flex-wrap gap-3">
              {data.inputFiles.map((file) => (
                <figure key={file.id} className="w-32">
                  <MessageImageBlock sources={[{ handle: { kind: 'entry', entryId: file.id }, url: '' }]} isSingle />
                  <figcaption className="mt-1 break-words text-muted-foreground">{file.name}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
  if (data.status === 'ready') {
    return (
      <div className="my-3 flex w-full max-w-xl flex-col items-start gap-1">
        <MessageImageBlock sources={sources} isSingle={sources.length === 1} />
        {promptDisclosure}
      </div>
    )
  }
  const pending = data.status === 'prompting' || data.status === 'generating'
  const run = async (action: () => unknown | Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
    } catch {
      notifyError?.(t('chat.illustration.command_failed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      className="my-3 flex min-h-48 w-full max-w-xl flex-col items-center justify-center gap-3 rounded-lg bg-muted p-5 text-sm text-muted-foreground"
      aria-busy={pending}>
      {pending && <LoaderCircle aria-hidden="true" className="size-6 animate-spin motion-reduce:animate-none" />}
      <span role="status">
        {pending
          ? t('chat.illustration.generating')
          : data.status === 'cancelled'
            ? t('chat.illustration.cancelled')
            : t(errorKeys[data.error ?? 'generation'])}
      </span>
      {promptDisclosure}
      {pending && cancelIllustration && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => cancelIllustration(target))}>
          {t('common.cancel')}
        </Button>
      )}
      {!pending &&
        data.prompt &&
        data.error !== 'incomplete' &&
        data.error !== 'invalid_references' &&
        retryIllustration && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => retryIllustration(target))}>
            {t('common.retry')}
          </Button>
        )}
    </div>
  )
}
