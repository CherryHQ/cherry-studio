import 'react-pdf/dist/esm/Page/AnnotationLayer.css'
import 'react-pdf/dist/esm/Page/TextLayer.css'

import { SelectOutlined, UnorderedListOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { Assistant, AttachedPage, Topic } from '@renderer/types'
import { Button, Checkbox, Empty, Flex, InputNumber, Popover, Space, Spin } from 'antd'
import { debounce, filter, find } from 'lodash'
import { PanelRight } from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Document, Outline, Page, pdfjs } from 'react-pdf'
import styled from 'styled-components'

import FilePicker from './FilePicker'

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
  setActiveTopic: (topic: Topic) => void
}

const PdfReader: React.FC<Props> = (props) => {
  const { topic, pageWidth, assistant, setActiveTopic } = props
  const { attachedPages = [] } = topic

  const { t } = useTranslation()
  const { updateTopic } = useAssistant(assistant.id)

  const [file, setFile] = useState<File | null>(null)
  const [pageTotal, setPageTotal] = useState(0)
  const [pageCurrent, setPageCurrent] = useState(1)
  const [pageContents, setPageContents] = useState<Map<number, string>>(new Map())
  const [showIndex, setShowIndex] = useState(false)
  const [showSelect, setShowSelect] = useState(false)
  const [scale, setScale] = useState(1)
  const [pageRefs, setPageRefs] = useState<React.RefObject<HTMLDivElement>[]>([])
  const [noOutline, setNoOutline] = useState(false)

  useEffect(() => {
    setPageRefs(Array.from({ length: pageTotal }, () => React.createRef<any>()))
  }, [pageTotal])

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
  }, [assistant.attachedDocument?.id])

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
      updateTopicAttachedPages([...attachedPages, { index: page, content: pageContents.get(page) || '' }])
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
  }, 200)

  const onZoomOut = debounce(() => {
    setScale(scale - 0.2)
  }, 200)

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
                    defaultValue={1}
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
                <Popover
                  arrow={false}
                  trigger={['click']}
                  content={<FilePicker assistant={assistant} />}
                  placement="bottomRight"
                  destroyTooltipOnHide>
                  <OperateButton icon={<PanelRight size={16} />} />
                </Popover>
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
                  description={t('reader.outlineEmpty')}
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
                    // 使用 Map 来存储页面内容
                    setPageContents((prevMap) => {
                      const newMap = new Map(prevMap)
                      newMap.set(page, text)
                      return newMap
                    })
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
    padding-top: 20px;
    height: 240px;
  }

  .outline-empty {
    margin-top: 100px;
  }
`

export default PdfReader
