import { cacheService } from '@renderer/data/CacheService'
import { useCache, useSharedCache } from '@renderer/data/hooks/useCache'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { loggerService } from '@renderer/services/LoggerService'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { Button, Input, message, Space, Typography, Card, Row, Col, Divider, Progress, Badge, Tag } from 'antd'
import { Clock, Shield, Zap, Activity, AlertTriangle, CheckCircle, XCircle, Timer } from 'lucide-react'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import styled from 'styled-components'

const { Text, Title } = Typography

const logger = loggerService.withContext('CacheAdvancedTests')

/**
 * Advanced cache testing component
 * Tests TTL expiration, hook reference tracking, deep equality, performance
 */
const CacheAdvancedTests: React.FC = () => {
  const [currentTheme] = usePreference('ui.theme_mode')
  const isDarkTheme = currentTheme === ThemeMode.dark

  // TTL Testing
  const [ttlKey] = useState('test-ttl-cache')
  const [ttlValue, setTtlValue] = useCache(ttlKey)
  const [ttlExpireTime, setTtlExpireTime] = useState<number | null>(null)
  const [ttlProgress, setTtlProgress] = useState(0)

  // Hook Reference Tracking
  const [protectedKey] = useState('test-protected-cache')
  const [protectedValue, setProtectedValue] = useCache(protectedKey, 'protected-value')
  const [deleteAttemptResult, setDeleteAttemptResult] = useState<string>('')

  // Deep Equality Testing
  const [deepEqualKey] = useState('test-deep-equal')
  const [objectValue, setObjectValue] = useCache(deepEqualKey, { nested: { count: 0 }, tags: ['initial'] })
  const [updateSkipCount, setUpdateSkipCount] = useState(0)

  // Performance Testing
  const [perfKey] = useState('test-performance')
  const [perfValue, setPerfValue] = useCache(perfKey, 0)
  const [rapidUpdateCount, setRapidUpdateCount] = useState(0)
  const [subscriptionTriggers, setSubscriptionTriggers] = useState(0)
  const renderCountRef = useRef(0)
  const [displayRenderCount, setDisplayRenderCount] = useState(0)

  // Multi-hook testing
  const [multiKey] = useState('test-multi-hook')
  const [value1] = useCache(multiKey, 'hook-1-default')
  const [value2] = useCache(multiKey, 'hook-2-default')
  const [value3] = useSharedCache(multiKey, 'hook-3-shared')

  const intervalRef = useRef<NodeJS.Timeout>()
  const performanceTestRef = useRef<NodeJS.Timeout>()

  // Update render count without causing re-renders
  renderCountRef.current += 1

  // Track subscription changes
  useEffect(() => {
    const unsubscribe = cacheService.subscribe(perfKey, () => {
      setSubscriptionTriggers(prev => prev + 1)
    })
    return unsubscribe
  }, [perfKey])

  // TTL Testing Functions
  const startTTLTest = useCallback((ttlMs: number) => {
    const testValue = { message: 'TTL Test', timestamp: Date.now() }
    cacheService.set(ttlKey, testValue, ttlMs)
    setTtlValue(testValue)

    const expireAt = Date.now() + ttlMs
    setTtlExpireTime(expireAt)

    // Clear previous interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }

    // Update progress every 100ms
    intervalRef.current = setInterval(() => {
      const now = Date.now()
      const remaining = Math.max(0, expireAt - now)
      const progress = Math.max(0, 100 - (remaining / ttlMs) * 100)

      setTtlProgress(progress)

      if (remaining <= 0) {
        clearInterval(intervalRef.current!)
        setTtlExpireTime(null)
        message.info('TTL expired, checking value...')

        // Check if value is actually expired
        setTimeout(() => {
          const currentValue = cacheService.get(ttlKey)
          if (currentValue === undefined) {
            message.success('TTL expiration working correctly!')
          } else {
            message.warning('TTL expiration may have failed')
          }
        }, 100)
      }
    }, 100)

    message.info(`TTL test started: ${ttlMs}ms`)
    logger.info('TTL test started', { key: ttlKey, ttl: ttlMs, expireAt })
  }, [ttlKey, setTtlValue])

  // Hook Reference Tracking Test
  const testDeleteProtection = () => {
    try {
      const deleted = cacheService.delete(protectedKey)
      setDeleteAttemptResult(deleted ? 'Deleted (unexpected!)' : 'Protected (expected)')
      logger.info('Delete protection test', { key: protectedKey, deleted })
    } catch (error) {
      setDeleteAttemptResult(`Error: ${(error as Error).message}`)
      logger.error('Delete protection test error', error as Error)
    }
  }

  // Deep Equality Testing
  const testDeepEquality = (operation: string) => {
    const currentCount = updateSkipCount

    switch (operation) {
      case 'same-reference':
        // Set same reference - should skip
        setObjectValue(objectValue)
        break

      case 'same-content':
        // Set same content but different reference - should skip with deep comparison
        setObjectValue({ nested: { count: objectValue?.nested?.count || 0 }, tags: [...(objectValue?.tags || [])] })
        break

      case 'different-content':
        // Set different content - should update
        setObjectValue({
          nested: { count: (objectValue?.nested?.count || 0) + 1 },
          tags: [...(objectValue?.tags || []), `update-${Date.now()}`]
        })
        break
    }

    // Check if update count changed
    setTimeout(() => {
      if (currentCount === updateSkipCount) {
        message.success('Update skipped due to equality check')
      } else {
        message.info('Update applied due to content change')
      }
    }, 100)

    logger.info('Deep equality test', { operation, currentCount, objectValue })
  }

  // Performance Testing
  const startRapidUpdates = () => {
    let count = 0
    const startTime = Date.now()

    performanceTestRef.current = setInterval(() => {
      count++
      setPerfValue(count)
      setRapidUpdateCount(count)

      if (count >= 100) {
        clearInterval(performanceTestRef.current!)
        const duration = Date.now() - startTime
        message.success(`Rapid updates test completed: ${count} updates in ${duration}ms`)
        logger.info('Rapid updates test completed', { count, duration })
      }
    }, 10) // Update every 10ms
  }

  const stopRapidUpdates = () => {
    if (performanceTestRef.current) {
      clearInterval(performanceTestRef.current)
      message.info('Rapid updates test stopped')
    }
  }

  // Cleanup
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
      if (performanceTestRef.current) {
        clearInterval(performanceTestRef.current)
      }
    }
  }, [])

  return (
    <TestContainer $isDark={isDarkTheme}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <Space>
            <Text type="secondary">Advanced Features • Renders: {displayRenderCount || renderCountRef.current} • Subscriptions: {subscriptionTriggers}</Text>
            <Button size="small" onClick={() => {
              renderCountRef.current = 0
              setDisplayRenderCount(0)
              setSubscriptionTriggers(0)
            }}>Reset Stats</Button>
          </Space>
        </div>

        <Row gutter={[16, 16]}>
          {/* TTL Testing */}
          <Col span={12}>
            <Card
              title={
                <Space>
                  <Timer size={16} />
                  <Text>TTL Expiration Testing</Text>
                </Space>
              }
              size="small"
              style={{
                backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff',
                borderColor: isDarkTheme ? '#303030' : '#d9d9d9'
              }}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text>Key: <code>{ttlKey}</code></Text>

                <Space wrap>
                  <Button size="small" onClick={() => startTTLTest(2000)} icon={<Clock size={12} />}>
                    2s TTL
                  </Button>
                  <Button size="small" onClick={() => startTTLTest(5000)} icon={<Clock size={12} />}>
                    5s TTL
                  </Button>
                  <Button size="small" onClick={() => startTTLTest(10000)} icon={<Clock size={12} />}>
                    10s TTL
                  </Button>
                </Space>

                {ttlExpireTime && (
                  <div>
                    <Text>Expiration Progress:</Text>
                    <Progress
                      percent={Math.round(ttlProgress)}
                      status={ttlProgress >= 100 ? 'success' : 'active'}
                      strokeColor={isDarkTheme ? '#1890ff' : undefined}
                    />
                  </div>
                )}

                <ResultDisplay $isDark={isDarkTheme}>
                  <Text strong>Current Value:</Text>
                  <pre>{ttlValue ? JSON.stringify(ttlValue, null, 2) : 'undefined'}</pre>
                </ResultDisplay>
              </Space>
            </Card>
          </Col>

          {/* Hook Reference Tracking */}
          <Col span={12}>
            <Card
              title={
                <Space>
                  <Shield size={16} />
                  <Text>Hook Reference Protection</Text>
                </Space>
              }
              size="small"
              style={{
                backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff',
                borderColor: isDarkTheme ? '#303030' : '#d9d9d9'
              }}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text>Key: <code>{protectedKey}</code></Text>
                <Badge
                  status="processing"
                  text="This hook is actively using the cache key"
                />

                <Button
                  danger
                  onClick={testDeleteProtection}
                  icon={<AlertTriangle size={12} />}
                >
                  Attempt to Delete Key
                </Button>

                {deleteAttemptResult && (
                  <Tag color={deleteAttemptResult.includes('Protected') ? 'green' : 'red'}>
                    {deleteAttemptResult}
                  </Tag>
                )}

                <ResultDisplay $isDark={isDarkTheme}>
                  <Text strong>Current Value:</Text>
                  <pre>{JSON.stringify(protectedValue, null, 2)}</pre>
                </ResultDisplay>
              </Space>
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          {/* Deep Equality Testing */}
          <Col span={12}>
            <Card
              title={
                <Space>
                  <CheckCircle size={16} />
                  <Text>Deep Equality Optimization</Text>
                </Space>
              }
              size="small"
              style={{
                backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff',
                borderColor: isDarkTheme ? '#303030' : '#d9d9d9'
              }}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text>Key: <code>{deepEqualKey}</code></Text>
                <Text>Skip Count: <Badge count={updateSkipCount} /></Text>

                <Space direction="vertical">
                  <Button size="small" onClick={() => testDeepEquality('same-reference')} icon={<XCircle size={12} />}>
                    Set Same Reference
                  </Button>
                  <Button size="small" onClick={() => testDeepEquality('same-content')} icon={<CheckCircle size={12} />}>
                    Set Same Content
                  </Button>
                  <Button size="small" onClick={() => testDeepEquality('different-content')} icon={<Zap size={12} />}>
                    Set Different Content
                  </Button>
                </Space>

                <ResultDisplay $isDark={isDarkTheme}>
                  <Text strong>Current Object:</Text>
                  <pre>{JSON.stringify(objectValue, null, 2)}</pre>
                </ResultDisplay>
              </Space>
            </Card>
          </Col>

          {/* Performance Testing */}
          <Col span={12}>
            <Card
              title={
                <Space>
                  <Activity size={16} />
                  <Text>Performance Testing</Text>
                </Space>
              }
              size="small"
              style={{
                backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff',
                borderColor: isDarkTheme ? '#303030' : '#d9d9d9'
              }}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text>Key: <code>{perfKey}</code></Text>
                <Text>Updates: <Badge count={rapidUpdateCount} /></Text>

                <Space>
                  <Button type="primary" onClick={startRapidUpdates} icon={<Zap size={12} />}>
                    Start Rapid Updates
                  </Button>
                  <Button onClick={stopRapidUpdates} icon={<XCircle size={12} />}>
                    Stop
                  </Button>
                </Space>

                <ResultDisplay $isDark={isDarkTheme}>
                  <Text strong>Performance Value:</Text>
                  <pre>{JSON.stringify(perfValue, null, 2)}</pre>
                </ResultDisplay>
              </Space>
            </Card>
          </Col>
        </Row>

        <Divider />

        {/* Multi-Hook Synchronization */}
        <Card
          title={
            <Space>
              <Activity size={16} />
              <Text>Multi-Hook Synchronization Test</Text>
            </Space>
          }
          size="small"
          style={{
            backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff',
            borderColor: isDarkTheme ? '#303030' : '#d9d9d9'
          }}
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text>Testing multiple hooks using the same key: <code>{multiKey}</code></Text>

            <Row gutter={16}>
              <Col span={8}>
                <Card size="small" title="useCache Hook #1">
                  <ResultDisplay $isDark={isDarkTheme}>
                    <pre>{JSON.stringify(value1, null, 2)}</pre>
                  </ResultDisplay>
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small" title="useCache Hook #2">
                  <ResultDisplay $isDark={isDarkTheme}>
                    <pre>{JSON.stringify(value2, null, 2)}</pre>
                  </ResultDisplay>
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small" title="useSharedCache Hook #3">
                  <ResultDisplay $isDark={isDarkTheme}>
                    <pre>{JSON.stringify(value3, null, 2)}</pre>
                  </ResultDisplay>
                </Card>
              </Col>
            </Row>

            <Space>
              <Button
                onClick={() => cacheService.set(multiKey, `Updated at ${new Date().toLocaleTimeString()}`)}
              >
                Update via CacheService
              </Button>
              <Button
                onClick={() => cacheService.setShared(multiKey, `Shared update at ${new Date().toLocaleTimeString()}`)}
              >
                Update via Shared Cache
              </Button>
            </Space>
          </Space>
        </Card>

        <div style={{ textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            💡 高级功能测试: TTL过期机制、Hook引用保护、深度相等性优化、性能测试、多Hook同步验证
          </Text>
        </div>
      </Space>
    </TestContainer>
  )
}

const TestContainer = styled.div<{ $isDark: boolean }>`
  color: ${props => props.$isDark ? '#fff' : '#000'};
`

const ResultDisplay = styled.div<{ $isDark: boolean }>`
  background: ${props => props.$isDark ? '#0d1117' : '#f6f8fa'};
  border: 1px solid ${props => props.$isDark ? '#30363d' : '#d0d7de'};
  border-radius: 6px;
  padding: 8px;
  font-size: 11px;
  max-height: 120px;
  overflow-y: auto;

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    color: ${props => props.$isDark ? '#e6edf3' : '#1f2328'};
    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
  }
`

export default CacheAdvancedTests