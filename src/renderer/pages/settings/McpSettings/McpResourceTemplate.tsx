import { UriTemplate } from '@modelcontextprotocol/client'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button, Input, Label } from '@cherrystudio/ui'
import type { McpResourceTemplate as Template } from '@shared/types/mcp'

import McpResourcePreview from './McpResourcePreview'

export default function McpResourceTemplate({ template }: { template: Template }) {
  const { t } = useTranslation()
  const parsed = useMemo(() => {
    try {
      return new UriTemplate(template.uriTemplate)
    } catch {
      return undefined
    }
  }, [template.uriTemplate])
  const [values, setValues] = useState<Record<string, string>>({})
  const [previewUri, setPreviewUri] = useState<string>()
  let uri: string | undefined
  try {
    uri = parsed?.expand(values)
  } catch {
    /* Incomplete or invalid Unicode input cannot be expanded. */
  }
  return (
    <section className="flex flex-col gap-3 border-b border-border-subtle py-3">
      <h3 className="text-sm font-medium">{template.title ?? template.name}</h3>
      <p className="text-sm text-muted-foreground">{template.description}</p>
      <code className="break-all text-xs">{template.uriTemplate}</code>
      {!parsed ? (
        <Alert type="error" message={t('common.error')} />
      ) : (
        <>
          {parsed.variableNames.map((name) => (
            <Label key={name} className="flex flex-col items-stretch gap-1">
              {name}
              <Input
                value={values[name] ?? ''}
                onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))}
              />
            </Label>
          ))}
          <code className="break-all text-xs">{uri}</code>
          <div className="flex gap-2">
            <Button size="sm" disabled={!uri} onClick={() => setPreviewUri(uri)}>
              {t('common.preview')}
            </Button>
            {previewUri ? (
              <Button size="sm" variant="ghost" onClick={() => setPreviewUri(undefined)}>
                {t('common.close')}
              </Button>
            ) : null}
          </div>
          {previewUri ? <McpResourcePreview key={previewUri} serverId={template.serverId} uri={previewUri} /> : null}
        </>
      )}
    </section>
  )
}
