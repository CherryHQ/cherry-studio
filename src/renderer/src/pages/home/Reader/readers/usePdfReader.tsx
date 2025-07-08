import 'react-pdf/dist/esm/Page/AnnotationLayer.css'
import 'react-pdf/dist/esm/Page/TextLayer.css'

import { SelectOutlined, UnorderedListOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons'
import { Checkbox, Empty, Flex, InputNumber, Space, Spin, Tooltip } from 'antd'
import { debounce, find } from 'lodash'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Document, Outline, Page, pdfjs } from 'react-pdf'
import LinkService from 'react-pdf/dist/esm/LinkService.js'
import { ScrollPageIntoViewArgs } from 'react-pdf/dist/esm/shared/types.js'
import styled from 'styled-components'

import { OperateButton, OperateRow } from '..'

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
  pageWidth: number
  pdfFile: File | null | undefined
  selectedPages: number[]
  onTriggerSelectPage: (checked: boolean, page: number) => void
}

const usePdfReader = (props: Props) => {
  const { selectedPages, pageWidth, pdfFile, onTriggerSelectPage } = props

  const { t } = useTranslation()

  const documentRef = useRef<{
    linkService: React.RefObject<LinkService>
    pages: React.RefObject<HTMLDivElement[]>
    viewer: React.RefObject<{
      scrollPageIntoView: (args: ScrollPageIntoViewArgs) => void
    }>
  } | null>(null)
  const docDivRef = useRef<HTMLDivElement | null>(null)
  const pageRefs = useRef<{ [key: number]: HTMLDivElement | null }>({})

  const [pageTotal, setPageTotal] = useState(0)
  const [pageCurrent, setPageCurrent] = useState(1)
  const [pageContents, setPageContents] = useState<Map<number, string>>(new Map())
  const [showOutline, setShowOutline] = useState(false)
  const [showSelect, setShowSelect] = useState(false)
  const [scale, setScale] = useState(1)
  const [noOutline, setNoOutline] = useState(false)

  const handlePageRef = (page: number) => (el: HTMLDivElement) => {
    pageRefs.current[page] = el
  }

  const handleLocatePage = (num: number) => {
    documentRef.current?.viewer.current.scrollPageIntoView({
      pageNumber: num
    })
  }

  useEffect(() => {
    if (docDivRef.current) {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const pageNumber = parseInt(entry.target.getAttribute('data-page-number') || '1')
              setPageCurrent(pageNumber)
              break
            }
          }
        },
        {
          root: docDivRef.current,
          threshold: 0.5 // 50% 可见时触发
        }
      )

      const currentPageRefs = Object.values(pageRefs.current)
      currentPageRefs.forEach((el) => {
        if (el) observer.observe(el)
      })

      return () => {
        currentPageRefs.forEach((el) => {
          if (el) observer.unobserve(el)
        })
      }
    }

    return undefined
  }, [pageTotal])

  const onZoomIn = debounce(() => {
    setScale(scale + 0.2)
  }, 200)

  const onZoomOut = debounce(() => {
    setScale(scale - 0.2)
  }, 200)

  const onLoadSuccess = (pdf: any) => {
    setPageTotal(pdf.numPages)
  }

  const ReaderOperateRow = (
    <OperateRow gap={8} align="center" justify="space-between">
      <Space>
        <Tooltip title={t('reader.showOutline')}>
          <OperateButton
            onClick={() => setShowOutline((state) => !state)}
            data-active={showOutline}
            icon={<UnorderedListOutlined size={14} />}
          />
        </Tooltip>
        <Tooltip title={t('reader.showSelect')}>
          <OperateButton
            icon={<SelectOutlined size={14} />}
            data-active={showSelect}
            onClick={() => {
              setShowSelect((state) => !state)
            }}
          />
        </Tooltip>
      </Space>
      <Space>
        <Tooltip title={t('reader.zoomIn')}>
          <OperateButton icon={<ZoomInOutlined size={14} />} onClick={onZoomIn} />
        </Tooltip>
        <span>{`${scale * 100}%`}</span>
        <Tooltip title={t('reader.zoomOut')}>
          <OperateButton icon={<ZoomOutOutlined size={14} />} onClick={onZoomOut} />
        </Tooltip>
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
      </Space>
    </OperateRow>
  )

  const Reader = (
    <DocumentReader
      ref={documentRef}
      inputRef={docDivRef}
      file={pdfFile}
      options={options}
      onLoadSuccess={onLoadSuccess}
      loading={PdfStatueRender.LOADING}
      error={PdfStatueRender.ERROR}
      noData={PdfStatueRender.NO_DATA}>
      <OutlineWrapper className={showOutline ? 'visible' : ''}>
        <Outline
          className="outline"
          onItemClick={({ pageNumber }) => {
            handleLocatePage(pageNumber)
            setShowOutline(false)
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
      {Array.from(new Array(pageTotal), (_el, index) => {
        const page = index + 1
        const checked = !!find(selectedPages, (p) => p === page)

        return (
          <PageWrapper
            key={index}
            inputRef={handlePageRef(page)}
            width={pageWidth}
            scale={scale}
            pageNumber={page}
            loading={null}
            error={null}
            noData={null}
            data-page-number={page}
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
                onChange={() => onTriggerSelectPage(checked, page)}
              />
            )}
          </PageWrapper>
        )
      })}
    </DocumentReader>
  )

  return useMemo(
    () => ({
      Reader,
      ReaderOperateRow,
      pageContents
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedPages, pageWidth, pdfFile, pageContents]
  )
}

const DocumentReader = styled(Document)`
  position: relative;
  overflow-y: auto;
  width: 100%;
  height: 100%;

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

const PageWrapper = styled(Page)`
  position: relative;
  margin-bottom: 8px;
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
  position: sticky;
  top: 0;
  width: 100%;
  height: 0;
  z-index: 5;
  background-color: var(--color-background);
  transition: width 0.2s ease-in-out;

  .outline {
    height: 100%;
    overflow-y: auto;
  }

  &.visible {
    padding: 12px 0;
    height: 240px;
    border-bottom: 1px solid var(--color-border);
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
  }

  .outline-empty {
    margin-top: 100px;
  }
`

export default usePdfReader
