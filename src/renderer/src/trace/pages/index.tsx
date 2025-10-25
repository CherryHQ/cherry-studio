import './Trace.css'

import { SpanEntity } from '@mcp-trace/trace-core'
import { TraceModal } from '@renderer/trace/pages/TraceModel'
import { Divider } from 'antd/lib'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { findNodeById, mergeTraceModals, updatePercentAndStart } from '../utils'
import { Box, GridItem, SimpleGrid, Text, VStack } from './Component'
import SpanDetail from './SpanDetail'
import TraceTree from './TraceTree'

export interface TracePageProp {
  topicId: string
  traceId: string
  modelName?: string
  reload?: boolean
}

export const TracePage: React.FC<TracePageProp> = ({ topicId, traceId, modelName, reload = false }) => {
  const [spans, setSpans] = useState<TraceModal[]>([])
  const [selectNodeId, setSelectNodeId] = useState<string | null>(null)
  const selectNode = useMemo(() => (selectNodeId ? findNodeById(spans, selectNodeId) : null), [selectNodeId, spans])
  const showList = useMemo(() => selectNodeId === null || !selectNode, [selectNode, selectNodeId])
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const { t } = useTranslation()

  const getRootSpan = (spans: SpanEntity[]): TraceModal[] => {
    const map: Map<string, TraceModal> = new Map()

    spans.map((span) => {
      map.set(span.id, { ...span, children: [], percent: 100, start: 0 })
    })

    return Array.from(
      map.values().filter((span) => {
        if (span.parentId && map.has(span.parentId)) {
          const parent = map.get(span.parentId)
          if (parent) {
            parent.children.push(span)
          }
          return false
        }
        return true
      })
    )
  }

  const getTraceData = useCallback(async (): Promise<boolean> => {
    const datas = topicId && traceId ? await window.api.trace.getData(topicId, traceId, modelName) : []
    const matchedSpans = getRootSpan(datas)
    updatePercentAndStart(matchedSpans)
    setSpans((prev) => mergeTraceModals(prev, matchedSpans))
    const isEnded = !matchedSpans.find((e) => !e.endTime || e.endTime <= 0)
    return isEnded
  }, [topicId, traceId, modelName])

  const handleNodeClick = (nodeId: string) => {
    setSelectNodeId(nodeId)
  }

  const handleShowList = () => {
    setSelectNodeId(null)
  }

  useEffect(() => {
    const handleShowTrace = async () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      const ended = await getTraceData()
      // 只有未结束时才启动定时刷新
      if (!ended) {
        intervalRef.current = setInterval(async () => {
          const endedInner = await getTraceData()
          if (endedInner && intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
        }, 300)
      }
    }
    handleShowTrace()
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [getTraceData, traceId, topicId, reload])

  return (
    <div className="trace-window">
      <div className="tab-container_trace">
        <SimpleGrid columns={1} templateColumns="1fr">
          <Box padding={0} className="scroll-container">
            {showList ? (
              <VStack gap={1} align="start">
                {spans.length === 0 ? (
                  <Text>没有找到Trace信息</Text>
                ) : (
                  <>
                    <SimpleGrid columns={20} style={{ width: '100%' }} className="floating">
                      <GridItem colSpan={8} padding={0} className={'table-header'}>
                        <Text tabIndex={0}>{t('trace.name')}</Text>
                      </GridItem>
                      <GridItem colSpan={5} padding={0} className={'table-header'}>
                        <Text>{t('trace.tokenUsage')}</Text>&nbsp;
                      </GridItem>
                      <GridItem colSpan={3} padding={0} className={'table-header'}>
                        <Text>{t('trace.spendTime')}</Text>
                      </GridItem>
                      <GridItem colSpan={4} padding={0} className={'table-header'}>
                        <Text></Text>
                      </GridItem>
                    </SimpleGrid>
                    <Divider
                      orientation="end"
                      style={{
                        width: '100%',
                        marginTop: '36px',
                        marginBottom: '0px'
                      }}
                    />
                    {spans.map((node: TraceModal) => (
                      <TraceTree key={node.id} treeData={node.children} node={node} handleClick={handleNodeClick} />
                    ))}
                  </>
                )}
              </VStack>
            ) : (
              selectNode && <SpanDetail node={selectNode} clickShowModal={handleShowList} />
            )}
          </Box>
        </SimpleGrid>
      </div>
    </div>
  )
}
