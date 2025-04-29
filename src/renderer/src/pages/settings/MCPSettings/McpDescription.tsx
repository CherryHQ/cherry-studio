import { useTheme } from '@renderer/context/ThemeProvider'
import { getShikiInstance } from '@renderer/utils/shiki'
import { Card } from 'antd'
import MarkdownIt from 'markdown-it'
import { npxFinder } from 'npx-scope-finder'
import { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

interface McpDescriptionProps {
  searchKey: string
}

const MCPDescription = ({ searchKey }: McpDescriptionProps) => {
  const [renderedMarkdown, setRenderedMarkdown] = useState('')
  const [loading, setLoading] = useState(false)

  const md = useRef<MarkdownIt>(
    new MarkdownIt({
      linkify: true, // 自动转换 URL 为链接
      typographer: true // 启用印刷格式优化
    })
  )
  const { theme } = useTheme()

  const getMcpInfo = useCallback(async () => {
    setLoading(true)
    const packages = await npxFinder(searchKey).finally(() => setLoading(false))
    const readme = packages[0]?.original?.readme ?? '暂无描述'
    setRenderedMarkdown(md.current.render(readme))
  }, [md, searchKey])

  useEffect(() => {
    const sk = getShikiInstance(theme)
    md.current.use(sk)
    getMcpInfo()
  }, [getMcpInfo, theme])

  return (
    <Section>
      <Card loading={loading}>
        <div className="markdown" dangerouslySetInnerHTML={{ __html: renderedMarkdown }} />
      </Card>
    </Section>
  )
}
const Section = styled.div`
  padding-top: 8px;
`

export default MCPDescription
