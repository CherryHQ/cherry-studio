import 'react-pdf/dist/esm/Page/AnnotationLayer.css'
import 'react-pdf/dist/esm/Page/TextLayer.css'

import {
  InsertRowLeftOutlined,
  InsertRowRightOutlined,
  SelectOutlined,
  UnorderedListOutlined,
  ZoomInOutlined,
  ZoomOutOutlined
} from '@ant-design/icons'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { Assistant, AttachedPage, Topic } from '@renderer/types'
import { Button, Checkbox, Empty, Flex, InputNumber, Space, Spin } from 'antd'
import { debounce, filter, find } from 'lodash'
import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Document, Outline, Page, pdfjs } from 'react-pdf'
import styled from 'styled-components'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
const options = {
  cMapUrl: '/cmaps/',
  standardFontDataUrl: '/standard_fonts/'
}

const PdfStatueRender = {
  LOADING: () => <Spin size="large" className="document-loading" spinning />,
  ERROR: () => <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />,
  NO_DATA: () => <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
}

interface Props {
  assistant: Assistant
  topic: Topic
  pageWidth: number
  readerLayout: 'left' | 'right'
  setActiveTopic: (topic: Topic) => void
  setReaderLayout: (layout: 'left' | 'right') => void
}

let observer: IntersectionObserver | null
const PdfReader: React.FC<Props> = (props) => {
  const { topic, pageWidth, assistant, readerLayout = 'left', setActiveTopic, setReaderLayout } = props
  const { attachedPages = [] } = topic

  const { t } = useTranslation()
  const { updateTopic } = useAssistant(assistant.id)

  const [file, setFile] = useState<File | null>(null)
  const [pageTotal, setPageTotal] = useState(0)
  const [pageCurrent, setPageCurrent] = useState(1)
  const [pageContents, setPageContents] = useState<string[]>([])
  const [showIndex, setShowIndex] = useState(false)
  const [showSelect, setShowSelect] = useState(false)
  const [scale, setScale] = useState(1)
  const [pageRefs, setPageRefs] = useState<React.RefObject<HTMLDivElement>[]>([])

  const [noOutline, setNoOutline] = useState(false)

  useEffect(() => {
    setPageRefs(Array.from({ length: pageTotal }, () => React.createRef<any>()))
  }, [pageTotal])

  useEffect(() => {
    const observerOptions = {
      root: null,
      rootMargin: '0px',
      threshold: 1
    }

    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const page = parseInt(entry.target.id.split('_')[1], 10)
          setPageCurrent(page)
        }
      })
    }

    // 只有当 observer 尚未初始化时才创建
    if (!observer) {
      observer = new IntersectionObserver(handleIntersection, observerOptions)
    }

    // 观察所有页面引用
    pageRefs.forEach((ref) => {
      if (ref.current) {
        observer?.observe(ref.current)
      }
    })

    return () => {
      // 清理操作时断开 observer
      observer?.disconnect()
      observer = null
    }
  }, [pageRefs, pageWidth])

  useEffect(() => {
    const loadFile = async () => {
      if (assistant.attachedDocument) {
        const { data, mime } = await window.api.file.binaryImage(
          assistant.attachedDocument.id + assistant.attachedDocument.ext
        )
        setFile(new File([data], assistant.attachedDocument.name, { type: mime }))
      }
    }

    loadFile()
  }, [assistant.attachedDocument])

  const updateTopicAttachedPages = (newData: AttachedPage[]) => {
    const data = {
      ...topic,
      attachedPages: newData
    }
    updateTopic(data)
    setActiveTopic(data)
  }

  const handleTriggerSelectedPages = (checked, page) => {
    if (checked) {
      updateTopicAttachedPages(filter(attachedPages, (p) => p.index !== page))
    } else {
      updateTopicAttachedPages([...attachedPages, { index: page, content: pageContents[page - 1] }])
    }
  }

  const handleLocatePage = (num: number) => {
    pageRefs[num - 1].current.scrollIntoView({
      behavior: 'smooth',
      block: 'end'
    })
  }

  const pdfFile = useMemo(() => {
    if (file) {
      return file
    }

    return null
  }, [file])

  const onZoomIn = debounce(() => {
    setScale(scale + 0.2)
  }, 100)

  const onZoomOut = debounce(() => {
    setScale(scale - 0.2)
  }, 100)

  const onLoadSuccess = (pdf: any) => {
    setPageTotal(pdf.numPages)
  }

  return (
    <Container>
      {pdfFile && (
        <Document
          file={pdfFile}
          options={options}
          onLoadSuccess={onLoadSuccess}
          loading={PdfStatueRender.LOADING}
          error={PdfStatueRender.ERROR}
          noData={PdfStatueRender.NO_DATA}>
          <OperationBar>
            <Flex gap={8} align="center" justify="space-between">
              <Space>
                <OperateButton
                  onClick={() => setShowIndex((state) => !state)}
                  data-active={showIndex}
                  icon={<UnorderedListOutlined />}
                />
                <OperateButton
                  icon={<SelectOutlined />}
                  data-active={showSelect}
                  onClick={() => {
                    setShowSelect((state) => !state)
                  }}
                />
              </Space>
              <Space>
                <OperateButton icon={<ZoomInOutlined />} onClick={onZoomIn} />
                <span>{`${scale * 100}%`}</span>
                <OperateButton icon={<ZoomOutOutlined />} onClick={onZoomOut} />
              </Space>
              <Space size={12}>
                <Pagination align="center">
                  <InputNumber
                    controls={false}
                    min={1}
                    max={pageTotal}
                    className="page-input"
                    value={pageCurrent}
                    onChange={(num) => {
                      setPageCurrent(num || 1)
                    }}
                    onPressEnter={(e) => {
                      handleLocatePage(Number((e.target as HTMLInputElement).value) || 1)
                    }}
                  />
                  /<span className="page-total">{pageTotal}</span>
                </Pagination>
                <OperateButton
                  icon={readerLayout === 'left' ? <InsertRowRightOutlined /> : <InsertRowLeftOutlined />}
                  onClick={() => setReaderLayout(readerLayout === 'left' ? 'right' : 'left')}
                />
              </Space>
            </Flex>
            <OutlineWrapper className={showIndex ? 'visible' : ''}>
              <Outline
                onItemClick={({ pageNumber }) => {
                  handleLocatePage(pageNumber)
                  setShowIndex(false)
                }}
                onLoadSuccess={(outline) => {
                  if (!outline) {
                    setNoOutline(true)
                  } else {
                    setNoOutline(false)
                  }
                }}
              />
              {noOutline && (
                <Empty
                  className="outline-empty"
                  description={t('document_reader.outline.empty')}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              )}
            </OutlineWrapper>
          </OperationBar>
          {Array.from(new Array(pageTotal), (_el, index) => {
            const page = index + 1
            const checked = !!find(attachedPages, (p) => p.index === page)

            return (
              <PageWrapper key={index} id={`page_${page}`} ref={pageRefs[index]}>
                <Page
                  width={pageWidth}
                  scale={scale}
                  pageNumber={page}
                  loading={null}
                  error={null}
                  noData={null}
                  onGetTextSuccess={({ items }) => {
                    const text = items.reduce((acc, item: any) => {
                      if (item.str === '') {
                        return acc + `\r\n`
                      }
                      return acc + item.str
                    }, ``)
                    setPageContents((state) => [...state, text])
                  }}>
                  {showSelect && (
                    <Checkbox
                      checked={checked}
                      className={`page-checker ${checked ? 'checked' : ''}`}
                      onChange={() => handleTriggerSelectedPages(checked, page)}
                    />
                  )}
                </Page>
              </PageWrapper>
            )
          })}
        </Document>
      )}
    </Container>
  )
}

const Container = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  flex: 1;
  border-right: 0.5px solid var(--color-border);
  overflow-y: auto;
  background-color: var(--color-background-mute);

  .document-loading {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }

  .page-checker {
    position: absolute;
    right: 12px;
    top: 12px;
    z-index: 4;
    flex-direction: row-reverse;

    &.checked {
      color: var(--color-primary);
    }
  }
`

const PageWrapper = styled.div`
  position: relative;
  margin-bottom: 8px;
`

const OperationBar = styled.div`
  z-index: 5;
  position: sticky;
  top: 0;
  right: 0;
  left: 0;
  width: 100%;
  padding: 12px 12px 16px 12px;

  background-color: var(--color-background);
  border-bottom: 1px solid var(--color-border);
`

const OperateButton = styled(Button)`
  &[data-active='true'] {
    color: var(--color-primary);
    border-color: var(--color-primary);
  }
`

const Pagination = styled(Flex)`
  gap: 4px;
  color: var(--color-primary-soft);

  .page-input {
    width: 50px;
    color: var(--color-primary-soft);
  }

  .page-total {
    font-size: 16px;
    color: var(--color-primary);
  }
`

const OutlineWrapper = styled.div`
  width: 100%;
  height: 0;
  left: 0;
  top: 0;
  bottom: 0;
  overflow-y: auto;
  z-index: 5;
  background-color: var(--color-background);
  transition: width 0.2s ease-in-out;

  &.visible {
    height: 240px;
  }

  .outline-empty {
    margin-top: 100px;
  }
`

export default PdfReader
