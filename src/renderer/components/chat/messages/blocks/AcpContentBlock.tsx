import { ContentBlockSchema } from '@modelcontextprotocol/core'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Scrollbar } from '@cherrystudio/ui'
import { StaticMarkdown } from '@renderer/components/markdown'
import { dataUrlToBlob } from '@renderer/utils/image'
import { tryFileUrlToPath } from '@shared/utils/file'

import Link from '../markdown/Link'
import { ToolArgsTable } from '../tools/shared/ArgsTable'
import { ClickableFilePath } from '../tools/shared/ClickableFilePath'
import MessageImageBlock from './MessageImageBlock'

function AcpAudio({ data, mimeType }: { data: string; mimeType: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const url = URL.createObjectURL(dataUrlToBlob(`data:${mimeType};base64,${data}`))
    if (ref.current) ref.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [data, mimeType])
  return <audio ref={ref} controls preload="none" className="max-w-full" />
}

export function AcpContentBlock({ content }: { content: unknown }) {
  const { t } = useTranslation()
  const parsed = ContentBlockSchema.safeParse(content)
  if (!parsed.success) return <ToolArgsTable args={{ content }} title={t('message.tools.sections.output')} />
  const block = parsed.data
  if (block.type === 'text') return <StaticMarkdown>{block.text}</StaticMarkdown>
  if (block.type === 'image')
    return <MessageImageBlock sources={[{ url: `data:${block.mimeType};base64,${block.data}` }]} isSingle />
  if (block.type === 'audio') return <AcpAudio data={block.data} mimeType={block.mimeType} />
  if (block.type === 'resource_link' || block.type === 'resource') {
    const resource = block.type === 'resource' ? block.resource : block
    const name = block.type === 'resource_link' ? (block.title ?? block.name) : resource.uri
    const path = tryFileUrlToPath(resource.uri)
    return (
      <div className="space-y-2 text-sm">
        {path ? (
          <ClickableFilePath path={path} displayName={name} />
        ) : /^https?:\/\//i.test(resource.uri) ? (
          <Link href={resource.uri}>{name}</Link>
        ) : (
          <span className="break-all text-muted-foreground">{name}</span>
        )}
        {block.type === 'resource_link' && block.description && (
          <p className="text-xs text-muted-foreground">{block.description}</p>
        )}
        {'text' in resource && typeof resource.text === 'string' && (
          <Scrollbar className="max-h-64 rounded-md bg-muted p-2">
            <pre className="whitespace-pre-wrap break-all text-xs">{resource.text}</pre>
          </Scrollbar>
        )}
        {'blob' in resource && typeof resource.blob === 'string' && (
          <a
            className="inline-block text-link hover:underline"
            download={path?.split(/[/\\]/).at(-1) ?? 'resource'}
            href={`data:application/octet-stream;base64,${resource.blob}`}>
            {t('common.download')}
          </a>
        )}
      </div>
    )
  }
  return <ToolArgsTable args={{ content }} title={t('message.tools.sections.output')} />
}
