import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { Card } from 'antd'
import { npxFinder } from 'npx-scope-finder'
import { FC, memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface McpDescriptionProps {
  searchKey: string
}

const MCPDescription: FC<McpDescriptionProps> = ({ searchKey }) => {
  const { t } = useTranslation()
  const { shikiMarkdownIt } = useCodeStyle()
  const [loading, setLoading] = useState(false)
  const [mcpInfo, setMcpInfo] = useState<string>('')

  useEffect(() => {
    let isMounted = true
    setLoading(true)
    npxFinder(searchKey)
      .then((packages) => {
        const readme = packages[0]?.original?.readme ?? t('settings.mcp.noDescriptionAvailable')
        shikiMarkdownIt(readme).then((result) => {
          if (isMounted) setMcpInfo(result)
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
    <Section>
      <Card loading={loading}>
        <div className="markdown" dangerouslySetInnerHTML={{ __html: mcpInfo }} />
      </Card>
    </Section>
  )
}
const Section = styled.div`
  padding-top: 8px;
  max-width: calc(100vw - var(--sidebar-width) - var(--settings-width) - 75px);
`

export default memo(MCPDescription)
