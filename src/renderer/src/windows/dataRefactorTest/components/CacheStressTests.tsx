import { cacheService } from '@renderer/data/CacheService'
import { useCache, useSharedCache } from '@renderer/data/hooks/useCache'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { loggerService } from '@renderer/services/LoggerService'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { Alert, Button, Card, Col, message, Progress, Row, Space, Statistic, Tag, Typography } from 'antd'
import { AlertTriangle, Database, HardDrive, TrendingUp, Users, Zap } from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

const { Text } = Typography

const logger = loggerService.withContext('CacheStressTests')

/**
 * Cache stress testing component
 * Tests performance limits, memory usage, concurrent operations
 */
const CacheStressTests: React.FC = () => {
  const [currentTheme] = usePreference('ui.theme_mode')
  const isDarkTheme = currentTheme === ThemeMode.dark

  // Test States
  const [isRunning, setIsRunning] = useState(false)
  const [testProgress, setTestProgress] = useState(0)
  const [testResults, setTestResults] = useState<any>({})

  // Performance Metrics
  const [operationsPerSecond, setOperationsPerSecond] = useState(0)
  const [totalOperations, setTotalOperations] = useState(0)
  const [memoryUsage, setMemoryUsage] = useState(0)
  const renderCountRef = useRef(0)
  const [displayRenderCount, setDisplayRenderCount] = useState(0)
  const [errorCount, setErrorCount] = useState(0)

  // Concurrent Testing
  const [concurrentValue1, setConcurrentValue1] = useCache('concurrent-test-1', 0)
  const [concurrentValue2, setConcurrentValue2] = useCache('concurrent-test-2', 0)
  const [concurrentShared, setConcurrentShared] = useSharedCache('concurrent-shared', 0)

  // Large Data Testing
  const [largeDataKey] = useState('large-data-test' as const)
  const [largeDataSize, setLargeDataSize] = useState(0)
  const [, setLargeDataValue] = useCache(largeDataKey as any, {})

  // Timers and refs
  const testTimerRef = useRef<NodeJS.Timeout>(null)
  const metricsTimerRef = useRef<NodeJS.Timeout>(null)
  const concurrentTimerRef = useRef<NodeJS.Timeout>(null)

  // Update render count without causing re-renders
  renderCountRef.current += 1

  // Memory Usage Estimation
  const estimateMemoryUsage = useCallback(() => {
    try {
      // Rough estimation based on localStorage size and objects
      const persistSize = localStorage.getItem('cs_cache_persist')?.length || 0
      const estimatedSize = persistSize + totalOperations * 50 // Rough estimate
      setMemoryUsage(estimatedSize)
    } catch (error) {
      logger.error('Memory usage estimation failed', error as Error)
    }
  }, [totalOperations])

  useEffect(() => {
    estimateMemoryUsage()
  }, [totalOperations, estimateMemoryUsage])

  // Rapid Fire Test
  const runRapidFireTest = useCallback(async () => {
    setIsRunning(true)
    setTestProgress(0)
    setTotalOperations(0)
    setErrorCount(0)

    const startTime = Date.now()
    const testDuration = 10000 // 10 seconds
    const targetOperations = 1000

    let operationCount = 0
    let errors = 0
    let shouldContinue = true // Use local variable instead of state

    const performOperation = () => {
      if (!shouldContinue) return // Check local flag

      try {
        const key = `rapid-test-${operationCount % 100}`
        const value = { id: operationCount, timestamp: Date.now(), data: Math.random().toString(36) }

        // Alternate between different cache types
        if (operationCount % 3 === 0) {
          cacheService.set(key, value)
        } else if (operationCount % 3 === 1) {
          cacheService.setShared(key, value)
        } else {
          cacheService.get(key)
        }

        operationCount++
        setTotalOperations(operationCount)
        setTestProgress((operationCount / targetOperations) * 100)

        // Calculate operations per second
        const elapsed = Date.now() - startTime
        setOperationsPerSecond(Math.round((operationCount / elapsed) * 1000))

        if (operationCount >= targetOperations || elapsed >= testDuration) {
          shouldContinue = false
          setIsRunning(false)
          setTestResults({
            duration: elapsed,
            operations: operationCount,
            opsPerSecond: Math.round((operationCount / elapsed) * 1000),
            errors
          })
          message.success(`Rapid fire test completed: ${operationCount} operations in ${elapsed}ms`)
          logger.info('Rapid fire test completed', { operationCount, elapsed, errors })
          return
        }

        // Schedule next operation
        setTimeout(performOperation, 1)
      } catch (error) {
        errors++
        setErrorCount(errors)
        logger.error('Rapid fire test operation failed', error as Error)
        if (shouldContinue) {
          setTimeout(performOperation, 1)
        }
      }
    }

    // Start the test
    performOperation()

    // Store a reference to the shouldContinue flag for stopping
    testTimerRef.current = setTimeout(() => {
      // This timer will be cleared if the test is stopped early
      shouldContinue = false
      setIsRunning(false)
    }, testDuration)
  }, [])

  // Concurrent Updates Test
  const startConcurrentTest = () => {
    let count1 = 0
    let count2 = 0
    let sharedCount = 0

    concurrentTimerRef.current = setInterval(() => {
      // Simulate concurrent updates from different sources
      setConcurrentValue1(++count1)
      setConcurrentValue2(++count2)
      setConcurrentShared(++sharedCount)

      if (count1 >= 100) {
        clearInterval(concurrentTimerRef.current!)
        message.success('Concurrent updates test completed')
      }
    }, 50) // Update every 50ms

    message.info('Concurrent updates test started')
  }

  const stopConcurrentTest = () => {
    if (concurrentTimerRef.current) {
      clearInterval(concurrentTimerRef.current)
      message.info('Concurrent updates test stopped')
    }
  }

  // Large Data Test
  const generateLargeData = (sizeKB: number) => {
    const targetSize = sizeKB * 1024
    const baseString = 'a'.repeat(1024) // 1KB string
    const chunks = Math.floor(targetSize / 1024)

    const largeObject = {
      id: Date.now(),
      size: sizeKB,
      chunks: chunks,
      data: Array(chunks).fill(baseString),
      metadata: {
        created: new Date().toISOString(),
        type: 'stress-test',
        description: `Large data test object of ${sizeKB}KB`
      }
    }

    try {
      setLargeDataValue(largeObject)
      setLargeDataSize(sizeKB)
      message.success(`Large data test: ${sizeKB}KB object stored`)
      logger.info('Large data test completed', { sizeKB, chunks })
    } catch (error) {
      message.error(`Large data test failed: ${(error as Error).message}`)
      logger.error('Large data test failed', error as Error)
    }
  }

  // LocalStorage Limit Test
  const testLocalStorageLimit = async () => {
    try {
      let testSize = 1
      let maxSize = 0

      while (testSize <= 10240) {
        // Test up to 10MB
        try {
          const testData = 'x'.repeat(testSize * 1024) // testSize KB
          localStorage.setItem('storage-limit-test', testData)
          localStorage.removeItem('storage-limit-test')
          maxSize = testSize
          testSize *= 2
        } catch (error) {
          break
        }
      }

      message.info(`LocalStorage limit test: ~${maxSize}KB available`)
      logger.info('LocalStorage limit test completed', { maxSize })
    } catch (error) {
      message.error(`LocalStorage limit test failed: ${(error as Error).message}`)
    }
  }

  // Stop all tests
  const stopAllTests = () => {
    setIsRunning(false)
    if (testTimerRef.current) {
      clearTimeout(testTimerRef.current)
      testTimerRef.current = null
    }
    if (concurrentTimerRef.current) {
      clearInterval(concurrentTimerRef.current)
      concurrentTimerRef.current = null
    }
    message.info('All tests stopped')
  }

  // Cleanup
  useEffect(() => {
    const metricsCleanup = metricsTimerRef.current
    return () => {
      if (testTimerRef.current) clearTimeout(testTimerRef.current)
      if (metricsCleanup) clearInterval(metricsCleanup)
      if (concurrentTimerRef.current) clearInterval(concurrentTimerRef.current)
    }
  }, [])

  return (
    <TestContainer $isDark={isDarkTheme}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <Space>
            <Text type="secondary">
              Stress Testing • Renders: {displayRenderCount || renderCountRef.current} • Errors: {errorCount}
            </Text>
            <Button
              size="small"
              onClick={() => {
                renderCountRef.current = 0
                setDisplayRenderCount(0)
                setErrorCount(0)
              }}>
              Reset Stats
            </Button>
          </Space>
        </div>

        {/* Performance Metrics */}
        <Row gutter={[16, 8]}>
          <Col span={6}>
            <Statistic title="Operations/Second" value={operationsPerSecond} prefix={<TrendingUp size={16} />} />
          </Col>
          <Col span={6}>
            <Statistic title="Total Operations" value={totalOperations} prefix={<Database size={16} />} />
          </Col>
          <Col span={6}>
            <Statistic title="Memory Usage (bytes)" value={memoryUsage} prefix={<HardDrive size={16} />} />
          </Col>
          <Col span={6}>
            <Statistic
              title="Error Count"
              value={errorCount}
              valueStyle={{ color: errorCount > 0 ? '#ff4d4f' : undefined }}
              prefix={<AlertTriangle size={16} />}
            />
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          {/* Rapid Fire Test */}
          <Col span={12}>
            <Card
              title={
                <Space>
                  <Zap size={16} />
                  <Text>Rapid Fire Operations</Text>
                </Space>
              }
              size="small"
              style={{
                backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff',
                borderColor: isDarkTheme ? '#303030' : '#d9d9d9'
              }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text>High-frequency cache operations test (1000 ops in 10s)</Text>

                <Progress
                  percent={Math.round(testProgress)}
                  status={isRunning ? 'active' : testProgress > 0 ? 'success' : 'normal'}
                  strokeColor={isDarkTheme ? '#1890ff' : undefined}
                />

                <Space>
                  <Button type="primary" onClick={runRapidFireTest} disabled={isRunning} icon={<Zap size={12} />}>
                    Start Rapid Fire Test
                  </Button>
                  <Button onClick={stopAllTests} disabled={!isRunning} danger>
                    Stop All Tests
                  </Button>
                </Space>

                {testResults.operations && (
                  <ResultDisplay $isDark={isDarkTheme}>
                    <Text strong>Test Results:</Text>
                    <pre>{JSON.stringify(testResults, null, 2)}</pre>
                  </ResultDisplay>
                )}
              </Space>
            </Card>
          </Col>

          {/* Concurrent Updates Test */}
          <Col span={12}>
            <Card
              title={
                <Space>
                  <Users size={16} />
                  <Text>Concurrent Updates</Text>
                </Space>
              }
              size="small"
              style={{
                backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff',
                borderColor: isDarkTheme ? '#303030' : '#d9d9d9'
              }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text>Multiple hooks updating simultaneously</Text>

                <Row gutter={8}>
                  <Col span={8}>
                    <Card size="small" title="Hook 1">
                      <Statistic value={concurrentValue1} />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card size="small" title="Hook 2">
                      <Statistic value={concurrentValue2} />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card size="small" title="Shared">
                      <Statistic value={concurrentShared} />
                    </Card>
                  </Col>
                </Row>

                <Space>
                  <Button type="primary" onClick={startConcurrentTest} icon={<Users size={12} />}>
                    Start Concurrent Test
                  </Button>
                  <Button onClick={stopConcurrentTest}>Stop</Button>
                </Space>
              </Space>
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          {/* Large Data Test */}
          <Col span={12}>
            <Card
              title={
                <Space>
                  <HardDrive size={16} />
                  <Text>Large Data Storage</Text>
                </Space>
              }
              size="small"
              style={{
                backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff',
                borderColor: isDarkTheme ? '#303030' : '#d9d9d9'
              }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text>Test cache with large objects</Text>

                <Space wrap>
                  <Button size="small" onClick={() => generateLargeData(10)}>
                    10KB Object
                  </Button>
                  <Button size="small" onClick={() => generateLargeData(100)}>
                    100KB Object
                  </Button>
                  <Button size="small" onClick={() => generateLargeData(1024)}>
                    1MB Object
                  </Button>
                </Space>

                {largeDataSize > 0 && (
                  <Alert
                    message={`Large data test completed`}
                    description={`Successfully stored ${largeDataSize}KB object in cache`}
                    type="success"
                    showIcon
                  />
                )}

                <ResultDisplay $isDark={isDarkTheme}>
                  <Text strong>Large Data Key: </Text>
                  <code>{largeDataKey}</code>
                  <br />
                  <Text strong>Current Size: </Text>
                  {largeDataSize}KB
                </ResultDisplay>
              </Space>
            </Card>
          </Col>

          {/* Storage Limits Test */}
          <Col span={12}>
            <Card
              title={
                <Space>
                  <AlertTriangle size={16} />
                  <Text>Storage Limits</Text>
                </Space>
              }
              size="small"
              style={{
                backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff',
                borderColor: isDarkTheme ? '#303030' : '#d9d9d9'
              }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text>Test localStorage capacity and limits</Text>

                <Alert
                  message="Warning"
                  description="This test may temporarily consume significant browser storage"
                  type="warning"
                  showIcon
                />

                <Button onClick={testLocalStorageLimit} icon={<Database size={12} />}>
                  Test Storage Limits
                </Button>

                <Space direction="vertical">
                  <Tag color="blue">Persist Cache Size Check</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Current persist cache: ~
                    {Math.round(JSON.stringify(localStorage.getItem('cs_cache_persist')).length / 1024)}KB
                  </Text>
                </Space>
              </Space>
            </Card>
          </Col>
        </Row>

        <div style={{ textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            ⚠️ 压力测试: 高频操作、并发更新、大数据存储、存储限制测试 • 可能会影响浏览器性能
          </Text>
        </div>
      </Space>
    </TestContainer>
  )
}

const TestContainer = styled.div<{ $isDark: boolean }>`
  color: ${(props) => (props.$isDark ? '#fff' : '#000')};
`

const ResultDisplay = styled.div<{ $isDark: boolean }>`
  background: ${(props) => (props.$isDark ? '#0d1117' : '#f6f8fa')};
  border: 1px solid ${(props) => (props.$isDark ? '#30363d' : '#d0d7de')};
  border-radius: 6px;
  padding: 8px;
  font-size: 11px;
  max-height: 120px;
  overflow-y: auto;

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    color: ${(props) => (props.$isDark ? '#e6edf3' : '#1f2328')};
    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
  }
`

export default CacheStressTests
