import { useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

interface Props {
  url: string
}

const useHtmlReader = (props: Props) => {
  const { url } = props
  const [htmlContent, setHtmlContent] = useState('')
  const [error, setError] = useState<Error | null>(null)
  const shadowContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fetchHtml = async () => {
      try {
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        const content = await response.text()
        setHtmlContent(content)
      } catch (err) {
        if (err instanceof Error) {
          setError(err)
        }
      }
    }

    fetchHtml()
  }, [url])

  useEffect(() => {
    if (shadowContainerRef.current && htmlContent) {
      const shadowRoot = shadowContainerRef.current.attachShadow({ mode: 'open' })
      shadowRoot.innerHTML = htmlContent
    }
  }, [htmlContent])

  const Reader = (
    <HtmlReader>
      {error && <div>Error: {error.message}</div>}
      <ShowRoot ref={shadowContainerRef} />
    </HtmlReader>
  )

  return useMemo(() => ({ Reader }), [url])
}

const HtmlReader = styled.div`
  position: relative;
  overflow-y: auto;
  width: 100%;
  height: 100%;
  background-color: var(--color-background);
`

const ShowRoot = styled.div`
  width: 100%;
  height: 100%;
`

export default useHtmlReader
