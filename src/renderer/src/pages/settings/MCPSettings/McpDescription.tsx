import { Spinner } from '@cherrystudio/ui'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useTheme } from '@renderer/context/ThemeProvider'
import DOMPurify from 'dompurify'
import { npxFinder } from 'npx-scope-finder'
import type { FC } from 'react'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface McpDescriptionProps {
  searchKey: string
}

const MCPDescription: FC<McpDescriptionProps> = ({ searchKey }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { shikiMarkdownIt } = useCodeStyle()
  const [loading, setLoading] = useState(false)
  const [mcpInfo, setMcpInfo] = useState<string>('')

  useEffect(() => {
    let isMounted = true
    setLoading(true)
    void npxFinder(searchKey)
      .then((packages) => {
        const readme = packages[0]?.original?.readme ?? t('settings.mcp.noDescriptionAvailable')
        void shikiMarkdownIt(readme).then((result) => {
          if (isMounted) setMcpInfo(DOMPurify.sanitize(result))
        })
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })
    return () => {
      isMounted = false
    }
  }, [shikiMarkdownIt, searchKey, t])

  return (
    <div className="max-w-[calc(100vw-var(--sidebar-width)-var(--settings-width)-75px)] pt-2">
      <div
        className="rounded-lg border border-border bg-card p-6"
        style={{
          backgroundColor: theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'var(--card)',
          borderColor: 'var(--border)'
        }}>
        {loading ? (
          <Spinner text={t('common.loading')} />
        ) : (
          <div className="markdown" dangerouslySetInnerHTML={{ __html: mcpInfo }} />
        )}
      </div>
    </div>
  )
}

export default memo(MCPDescription)
