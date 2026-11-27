import { useTranslation } from 'react-i18next'

import { ToolResultLink } from './ToolResultLink'
import type { ToolResultLinkData } from './toolResultLinks'

const MAX_PREVIEW_LINKS = 20

export function ToolResultLinkList({ links }: { links: ToolResultLinkData[] }) {
  const { t } = useTranslation()
  const omitted = links.length - MAX_PREVIEW_LINKS

  return (
    <>
      {links.slice(0, MAX_PREVIEW_LINKS).map((link, index) => (
        <ToolResultLink key={`${index}:${link.url}`} {...link} />
      ))}
      {omitted > 0 && (
        <div className="mt-2 text-xs text-muted-foreground">{t('message.tools.linksOmitted', { count: omitted })}</div>
      )}
    </>
  )
}
