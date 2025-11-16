import { loggerService } from '@renderer/services/LoggerService'
import {
  Alert,
  Button,
  Card,
  Col,
  InputNumber,
  message,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography
} from 'antd'
import { Activity, AlertTriangle, Cpu, Gauge, RefreshCw, StopCircle, Timer, TrendingUp, Zap } from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

import { dataApiService } from '../../../data/DataApiService'

const { Text } = Typography

const logger = loggerService.withContext('DataApiStressTests')

interface StressTestConfig {
  concurrentRequests: number
  totalRequests: number
  requestDelay: number
  testDuration: number // in seconds
  errorRate: number // percentage of requests that should fail
}

interface StressTestResult {
  id: string
  requestId: number
  startTime: number
  endTime?: number
  duration?: number
  status: 'pending' | 'success' | 'error' | 'timeout'
  response?: any
  error?: string
  memoryBefore?: number
  memoryAfter?: number
}

interface StressTestSummary {
  totalRequests: number
  completedRequests: number
  successfulRequests: number
  failedRequests: number
  timeoutRequests: number
  averageResponseTime: number
  minResponseTime: number
  maxResponseTime: number
  requestsPerSecond: number
  errorRate: number
  memoryUsage: {
    initial: number
    peak: number
    final: number
    leaked: number
  }
  testDuration: number
}

const DataApiStressTests: React.FC = () => {
  const [config, setConfig] = useState<StressTestConfig>({
    concurrentRequests: 10,
    totalRequests: 100,
    requestDelay: 100,
    testDuration: 60,
    errorRate: 10
  })

  const [isRunning, setIsRunning] = useState(false)
  const [currentTest, setCurrentTest] = useState<string>('')
  const [results, setResults] = useState<StressTestResult[]>([])
  const [summary, setSummary] = useState<StressTestSummary | null>(null)
  const [progress, setProgress] = useState(0)
  const [realtimeStats, setRealtimeStats] = useState({
    rps: 0,
    avgResponseTime: 0,
    errorRate: 0,
    memoryUsage: 0
  })

  // Test control
  const abortControllerRef = useRef<AbortController | null>(null)
  const testStartTimeRef = useRef<number>(0)
  const completedCountRef = useRef<number>(0)
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Memory monitoring
  const getMemoryUsage = () => {
    if ((performance as any).memory) {
      return (performance as any).memory.usedJSHeapSize
    }
    return 0
  }

  // Update realtime statistics
  const updateRealtimeStats = useCallback(() => {
    const completedResults = results.filter((r) => r.status !== 'pending')
    const errorResults = completedResults.filter((r) => r.status === 'error')

    if (completedResults.length === 0) return

    const durations = completedResults.map((r) => r.duration || 0).filter((d) => d > 0)
    const avgResponseTime = durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : 0

    const elapsedTime = (Date.now() - testStartTimeRef.current) / 1000
    const rps = elapsedTime > 0 ? completedResults.length / elapsedTime : 0
    const errorRate = completedResults.length > 0 ? (errorResults.length / completedResults.length) * 100 : 0

    setRealtimeStats({
      rps: Math.round(rps * 100) / 100,
      avgResponseTime: Math.round(avgResponseTime),
      errorRate: Math.round(errorRate * 100) / 100,
      memoryUsage: Math.round((getMemoryUsage() / 1024 / 1024) * 100) / 100 // MB
    })
  }, [results])

  // Update statistics every second during testing
  useEffect(() => {
    if (isRunning) {
      statsIntervalRef.current = setInterval(updateRealtimeStats, 1000)
    } else if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current)
      statsIntervalRef.current = null
    }

    return () => {
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current)
      }
    }
  }, [isRunning, updateRealtimeStats])

  const executeStressTest = async (testName: string, testFn: (requestId: number) => Promise<any>) => {
    setIsRunning(true)
    setCurrentTest(testName)
    setResults([])
    setSummary(null)
    setProgress(0)
    completedCountRef.current = 0
    testStartTimeRef.current = Date.now()

    // Create abort controller
    abortControllerRef.current = new AbortController()
    const { signal } = abortControllerRef.current

    const initialMemory = getMemoryUsage()
    let peakMemory = initialMemory

    logger.info(`Starting stress test: ${testName}`, config)

    try {
      const testResults: StressTestResult[] = []

      // Initialize pending results
      for (let i = 0; i < config.totalRequests; i++) {
        testResults.push({
          id: `request-${i}`,
          requestId: i,
          startTime: 0,
          status: 'pending'
        })
      }
      setResults([...testResults])

      // Execute requests with controlled concurrency
      const executeRequest = async (requestId: number): Promise<void> => {
        if (signal.aborted) return

        const startTime = Date.now()
        const memoryBefore = getMemoryUsage()

        // Update memory peak
        peakMemory = Math.max(peakMemory, memoryBefore)

        testResults[requestId].startTime = startTime
        testResults[requestId].memoryBefore = memoryBefore
        setResults([...testResults])

        try {
          const response = await testFn(requestId)
          const endTime = Date.now()
          const duration = endTime - startTime
          const memoryAfter = getMemoryUsage()

          testResults[requestId] = {
            ...testResults[requestId],
            endTime,
            duration,
            status: 'success',
            response,
            memoryAfter
          }

          completedCountRef.current++
          setProgress((completedCountRef.current / config.totalRequests) * 100)
        } catch (error) {
          const endTime = Date.now()
          const duration = endTime - startTime
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'

          testResults[requestId] = {
            ...testResults[requestId],
            endTime,
            duration,
            status: errorMessage.includes('timeout') ? 'timeout' : 'error',
            error: errorMessage,
            memoryAfter: getMemoryUsage()
          }

          completedCountRef.current++
          setProgress((completedCountRef.current / config.totalRequests) * 100)
        }

        setResults([...testResults])
      }

      // Control concurrency
      let activeRequests = 0
      let nextRequestId = 0

      const processNextRequest = async () => {
        if (nextRequestId >= config.totalRequests || signal.aborted) {
          return
        }

        const requestId = nextRequestId++
        activeRequests++

        await executeRequest(requestId)

        activeRequests--

        // Add delay between requests if configured
        if (config.requestDelay > 0 && !signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, config.requestDelay))
        }

        // Continue processing if we haven't reached limits
        if (activeRequests < config.concurrentRequests && nextRequestId < config.totalRequests) {
          processNextRequest()
        }
      }

      // Start initial concurrent requests
      const initialRequests = Math.min(config.concurrentRequests, config.totalRequests)
      for (let i = 0; i < initialRequests; i++) {
        processNextRequest()
      }

      // Wait for all requests to complete or timeout
      const maxWaitTime = config.testDuration * 1000
      const waitStartTime = Date.now()

      while (completedCountRef.current < config.totalRequests && !signal.aborted) {
        if (Date.now() - waitStartTime > maxWaitTime) {
          logger.warn('Stress test timeout reached')
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      // Calculate final summary
      const finalMemory = getMemoryUsage()
      const completedResults = testResults.filter((r) => r.status !== 'pending')
      const failedResults = completedResults.filter((r) => r.status === 'error')
      const timeoutResults = completedResults.filter((r) => r.status === 'timeout')

      const durations = completedResults.map((r) => r.duration || 0).filter((d) => d > 0)
      const avgResponseTime = durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : 0
      const minResponseTime = durations.length > 0 ? Math.min(...durations) : 0
      const maxResponseTime = durations.length > 0 ? Math.max(...durations) : 0

      const testDuration = (Date.now() - testStartTimeRef.current) / 1000
      const requestsPerSecond = testDuration > 0 ? completedResults.length / testDuration : 0
      const errorRate = completedResults.length > 0 ? (failedResults.length / completedResults.length) * 100 : 0

      const testSummary: StressTestSummary = {
        totalRequests: config.totalRequests,
        completedRequests: completedResults.length,
        successfulRequests: completedResults.filter((r) => r.status === 'success').length,
        failedRequests: failedResults.length,
        timeoutRequests: timeoutResults.length,
        averageResponseTime: Math.round(avgResponseTime),
        minResponseTime,
        maxResponseTime,
        requestsPerSecond: Math.round(requestsPerSecond * 100) / 100,
        errorRate: Math.round(errorRate * 100) / 100,
        memoryUsage: {
          initial: Math.round((initialMemory / 1024 / 1024) * 100) / 100,
          peak: Math.round((peakMemory / 1024 / 1024) * 100) / 100,
          final: Math.round((finalMemory / 1024 / 1024) * 100) / 100,
          leaked: Math.round(((finalMemory - initialMemory) / 1024 / 1024) * 100) / 100
        },
        testDuration: Math.round(testDuration * 100) / 100
      }

      setSummary(testSummary)

      logger.info(`Stress test completed: ${testName}`, testSummary)
      const successfulCount = completedResults.filter((r) => r.status === 'success').length
      message.success(`Stress test completed! ${successfulCount}/${config.totalRequests} requests succeeded`)
    } catch (error) {
      logger.error('Stress test failed', error as Error)
      message.error('Stress test failed')
    } finally {
      setIsRunning(false)
      setCurrentTest('')
      abortControllerRef.current = null
    }
  }

  const runConcurrentRequestsTest = async () => {
    await executeStressTest('Concurrent Requests Test', async (requestId) => {
      // Alternate between different endpoints to simulate real usage
      const endpoints = ['/test/items', '/test/stats'] as const
      const endpoint = endpoints[requestId % endpoints.length]

      return await dataApiService.get(endpoint)
    })
  }

  const runMemoryLeakTest = async () => {
    await executeStressTest('Memory Leak Test', async (requestId) => {
      // Test different types of requests to ensure no memory leaks
      if (requestId % 5 === 0) {
        // Test slower requests
        return await dataApiService.post('/test/slow', { body: { delay: 500 } })
      } else {
        // Normal request
        return await dataApiService.get('/test/items')
      }
    })
  }

  const runErrorHandlingTest = async () => {
    await executeStressTest('Error Handling Stress Test', async (requestId) => {
      // Mix of successful and error requests
      const errorTypes = ['network', 'server', 'timeout', 'notfound', 'validation']
      const shouldError = Math.random() * 100 < config.errorRate

      if (shouldError) {
        const errorType = errorTypes[requestId % errorTypes.length]
        try {
          return await dataApiService.post('/test/error', { body: { errorType: errorType as any } })
        } catch (error) {
          return { expectedError: true, error: error instanceof Error ? error.message : 'Unknown error' }
        }
      } else {
        return await dataApiService.get('/test/items')
      }
    })
  }

  const runMixedOperationsTest = async () => {
    await executeStressTest('Mixed Operations Stress Test', async (requestId) => {
      const operations = ['GET', 'POST', 'PUT', 'DELETE']
      const operation = operations[requestId % operations.length]

      switch (operation) {
        case 'GET':
          return await dataApiService.get('/test/items')

        case 'POST':
          return await dataApiService.post('/test/items', {
            body: {
              title: `Stress Test Topic ${requestId}`,
              description: `Created during stress test #${requestId}`,
              type: 'stress-test'
            }
          })

        case 'PUT':
          // First get an item, then update it
          try {
            const items = await dataApiService.get('/test/items')
            if ((items as any).items && (items as any).items.length > 0) {
              const itemId = (items as any).items[0].id
              return await dataApiService.put(`/test/items/${itemId}`, {
                body: {
                  title: `Updated by stress test ${requestId}`
                }
              })
            }
          } catch (error) {
            return { updateFailed: true, error: error instanceof Error ? error.message : 'Unknown error' }
          }
          return { updateFailed: true, message: 'No items found to update' }

        default:
          return await dataApiService.get('/test/items')
      }
    })
  }

  const stopTest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      message.info('Stress test stopped by user')
    }
  }

  const resetTests = () => {
    stopTest()
    setResults([])
    setSummary(null)
    setProgress(0)
    setRealtimeStats({ rps: 0, avgResponseTime: 0, errorRate: 0, memoryUsage: 0 })
    message.info('Stress tests reset')
  }

  const resultColumns = [
    {
      title: 'Request ID',
      dataIndex: 'requestId',
      key: 'requestId',
      width: 100
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const colorMap = {
          success: 'green',
          error: 'red',
          timeout: 'orange',
          pending: 'blue'
        }
        return <Tag color={colorMap[status] || 'default'}>{status.toUpperCase()}</Tag>
      }
    },
    {
      title: 'Duration (ms)',
      dataIndex: 'duration',
      key: 'duration',
      render: (duration?: number) => (duration ? `${duration}ms` : '-')
    },
    {
      title: 'Memory Usage (KB)',
      key: 'memory',
      render: (_: any, record: StressTestResult) => {
        if (record.memoryBefore && record.memoryAfter) {
          const diff = Math.round((record.memoryAfter - record.memoryBefore) / 1024)
          return diff > 0 ? `+${diff}` : `${diff}`
        }
        return '-'
      }
    }
  ]

  return (
    <TestContainer>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Configuration Panel */}
        <Card title="Stress Test Configuration" size="small">
          <Row gutter={16}>
            <Col span={6}>
              <Text>Concurrent Requests:</Text>
              <InputNumber
                min={1}
                max={50}
                value={config.concurrentRequests}
                onChange={(value) => setConfig((prev) => ({ ...prev, concurrentRequests: value || 10 }))}
                style={{ width: '100%', marginTop: 4 }}
                disabled={isRunning}
              />
            </Col>
            <Col span={6}>
              <Text>Total Requests:</Text>
              <InputNumber
                min={10}
                max={1000}
                value={config.totalRequests}
                onChange={(value) => setConfig((prev) => ({ ...prev, totalRequests: value || 100 }))}
                style={{ width: '100%', marginTop: 4 }}
                disabled={isRunning}
              />
            </Col>
            <Col span={6}>
              <Text>Request Delay (ms):</Text>
              <InputNumber
                min={0}
                max={5000}
                value={config.requestDelay}
                onChange={(value) => setConfig((prev) => ({ ...prev, requestDelay: value || 0 }))}
                style={{ width: '100%', marginTop: 4 }}
                disabled={isRunning}
              />
            </Col>
            <Col span={6}>
              <Text>Error Rate (%):</Text>
              <InputNumber
                min={0}
                max={100}
                value={config.errorRate}
                onChange={(value) => setConfig((prev) => ({ ...prev, errorRate: value || 0 }))}
                style={{ width: '100%', marginTop: 4 }}
                disabled={isRunning}
              />
            </Col>
          </Row>
        </Card>

        {/* Control Panel */}
        <Row gutter={16}>
          <Col span={6}>
            <Button
              type="primary"
              icon={<Cpu size={16} />}
              onClick={runConcurrentRequestsTest}
              loading={isRunning && currentTest === 'Concurrent Requests Test'}
              disabled={isRunning}
              block>
              Concurrent Test
            </Button>
          </Col>
          <Col span={6}>
            <Button
              type="primary"
              icon={<Activity size={16} />}
              onClick={runMemoryLeakTest}
              loading={isRunning && currentTest === 'Memory Leak Test'}
              disabled={isRunning}
              block>
              Memory Test
            </Button>
          </Col>
          <Col span={6}>
            <Button
              type="primary"
              icon={<AlertTriangle size={16} />}
              onClick={runErrorHandlingTest}
              loading={isRunning && currentTest === 'Error Handling Stress Test'}
              disabled={isRunning}
              block>
              Error Test
            </Button>
          </Col>
          <Col span={6}>
            <Button
              type="primary"
              icon={<Zap size={16} />}
              onClick={runMixedOperationsTest}
              loading={isRunning && currentTest === 'Mixed Operations Stress Test'}
              disabled={isRunning}
              block>
              Mixed Test
            </Button>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Space>
              <Button danger icon={<StopCircle size={16} />} onClick={stopTest} disabled={!isRunning}>
                Stop Test
              </Button>
              <Button icon={<RefreshCw size={16} />} onClick={resetTests} disabled={isRunning}>
                Reset
              </Button>
            </Space>
          </Col>
          <Col span={12}>
            <Text type="secondary" style={{ float: 'right' }}>
              {isRunning && currentTest && `Running: ${currentTest}`}
            </Text>
          </Col>
        </Row>

        {/* Progress and Real-time Stats */}
        {isRunning && (
          <Card title="Test Progress" size="small">
            <Space direction="vertical" style={{ width: '100%' }}>
              <Progress percent={Math.round(progress)} status={isRunning ? 'active' : 'success'} showInfo />

              <Row gutter={16}>
                <Col span={6}>
                  <Statistic
                    title="Requests/Second"
                    value={realtimeStats.rps}
                    precision={2}
                    prefix={<TrendingUp size={16} />}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="Avg Response Time"
                    value={realtimeStats.avgResponseTime}
                    suffix="ms"
                    prefix={<Timer size={16} />}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="Error Rate"
                    value={realtimeStats.errorRate}
                    suffix="%"
                    prefix={<AlertTriangle size={16} />}
                    valueStyle={{ color: realtimeStats.errorRate > 10 ? '#cf1322' : '#3f8600' }}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="Memory Usage"
                    value={realtimeStats.memoryUsage}
                    suffix="MB"
                    prefix={<Gauge size={16} />}
                  />
                </Col>
              </Row>
            </Space>
          </Card>
        )}

        {/* Test Summary */}
        {summary && (
          <Card title="Test Summary" size="small">
            <Row gutter={16}>
              <Col span={8}>
                <Card size="small" title="Request Statistics">
                  <Space direction="vertical">
                    <Text>
                      Total Requests: <strong>{summary.totalRequests}</strong>
                    </Text>
                    <Text>
                      Completed: <strong>{summary.completedRequests}</strong>
                    </Text>
                    <Text>
                      Successful: <strong style={{ color: '#3f8600' }}>{summary.successfulRequests}</strong>
                    </Text>
                    <Text>
                      Failed: <strong style={{ color: '#cf1322' }}>{summary.failedRequests}</strong>
                    </Text>
                    <Text>
                      Timeouts: <strong style={{ color: '#d48806' }}>{summary.timeoutRequests}</strong>
                    </Text>
                  </Space>
                </Card>
              </Col>

              <Col span={8}>
                <Card size="small" title="Performance Metrics">
                  <Space direction="vertical">
                    <Text>
                      Test Duration: <strong>{summary.testDuration}s</strong>
                    </Text>
                    <Text>
                      Requests/Second: <strong>{summary.requestsPerSecond}</strong>
                    </Text>
                    <Text>
                      Avg Response Time: <strong>{summary.averageResponseTime}ms</strong>
                    </Text>
                    <Text>
                      Min Response Time: <strong>{summary.minResponseTime}ms</strong>
                    </Text>
                    <Text>
                      Max Response Time: <strong>{summary.maxResponseTime}ms</strong>
                    </Text>
                  </Space>
                </Card>
              </Col>

              <Col span={8}>
                <Card size="small" title="Memory Usage">
                  <Space direction="vertical">
                    <Text>
                      Initial: <strong>{summary.memoryUsage.initial}MB</strong>
                    </Text>
                    <Text>
                      Peak: <strong>{summary.memoryUsage.peak}MB</strong>
                    </Text>
                    <Text>
                      Final: <strong>{summary.memoryUsage.final}MB</strong>
                    </Text>
                    <Text>
                      Memory Change:
                      <strong
                        style={{
                          color: summary.memoryUsage.leaked > 5 ? '#cf1322' : '#3f8600'
                        }}>
                        {summary.memoryUsage.leaked > 0 ? '+' : ''}
                        {summary.memoryUsage.leaked}MB
                      </strong>
                    </Text>
                    <Text>
                      Error Rate: <strong>{summary.errorRate}%</strong>
                    </Text>
                  </Space>
                </Card>
              </Col>
            </Row>
          </Card>
        )}

        {/* Results Table */}
        {results.length > 0 && (
          <Card
            title={`Test Results (${results.filter((r) => r.status !== 'pending').length}/${results.length} completed)`}
            size="small">
            <Table
              dataSource={results.slice(-50)} // Show last 50 results to avoid performance issues
              columns={resultColumns}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 20 }}
              scroll={{ y: 400 }}
            />
          </Card>
        )}

        {/* Memory Usage Alert */}
        {summary && summary.memoryUsage.leaked > 10 && (
          <Alert
            message="Potential Memory Leak Detected"
            description={`Memory usage increased by ${summary.memoryUsage.leaked}MB during the test. This might indicate a memory leak.`}
            type="warning"
            showIcon
            closable
          />
        )}
      </Space>
    </TestContainer>
  )
}

const TestContainer = styled.div`
  .ant-statistic-title {
    font-size: 12px;
  }

  .ant-statistic-content {
    font-size: 16px;
  }

  .ant-progress-text {
    font-size: 12px;
  }

  .ant-table-small .ant-table-thead > tr > th {
    padding: 8px;
    font-size: 12px;
  }

  .ant-table-small .ant-table-tbody > tr > td {
    padding: 6px;
    font-size: 12px;
  }
`

export default DataApiStressTests
