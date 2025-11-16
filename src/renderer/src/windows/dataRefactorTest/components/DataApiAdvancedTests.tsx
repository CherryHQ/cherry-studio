import { loggerService } from '@renderer/services/LoggerService'
import { Alert, Button, Card, Col, message, Row, Space, Statistic, Table, Tag, Typography } from 'antd'
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  RotateCcw,
  Shield,
  StopCircle,
  Timer,
  XCircle,
  Zap
} from 'lucide-react'
import React, { useRef, useState } from 'react'
import styled from 'styled-components'

import { dataApiService } from '../../../data/DataApiService'

const { Text } = Typography

const logger = loggerService.withContext('DataApiAdvancedTests')

interface AdvancedTestResult {
  id: string
  name: string
  category: 'cancellation' | 'retry' | 'batch' | 'error' | 'performance'
  status: 'pending' | 'running' | 'success' | 'error' | 'cancelled'
  startTime?: number
  duration?: number
  response?: any
  error?: string
  metadata?: Record<string, any>
}

interface RetryTestConfig {
  maxRetries: number
  retryDelay: number
  backoffMultiplier: number
}

const DataApiAdvancedTests: React.FC = () => {
  const [testResults, setTestResults] = useState<AdvancedTestResult[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [, setCancelledRequests] = useState<string[]>([])
  const [, setRetryStats] = useState<any>(null)
  const [performanceStats, setPerformanceStats] = useState<any>(null)

  // Keep track of active abort controllers
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map())

  const updateTestResult = (id: string, updates: Partial<AdvancedTestResult>) => {
    setTestResults((prev) => prev.map((result) => (result.id === id ? { ...result, ...updates } : result)))
  }

  const addTestResult = (result: AdvancedTestResult) => {
    setTestResults((prev) => [...prev, result])
  }

  const runAdvancedTest = async (
    testId: string,
    testName: string,
    category: AdvancedTestResult['category'],
    testFn: (signal?: AbortSignal) => Promise<any>
  ) => {
    const startTime = Date.now()

    const testResult: AdvancedTestResult = {
      id: testId,
      name: testName,
      category,
      status: 'running',
      startTime
    }

    addTestResult(testResult)

    // Create abort controller for cancellation testing
    const abortController = new AbortController()
    abortControllersRef.current.set(testId, abortController)

    try {
      logger.info(`Starting advanced test: ${testName}`, { category })

      const response = await testFn(abortController.signal)
      const duration = Date.now() - startTime

      logger.info(`Advanced test completed: ${testName}`, { duration, response })

      updateTestResult(testId, {
        status: 'success',
        duration,
        response,
        error: undefined
      })

      message.success(`${testName} completed successfully`)
      return response
    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      const isAborted = error instanceof Error && error.message.includes('cancelled')
      const status = isAborted ? 'cancelled' : 'error'

      logger.error(`Advanced test ${status}: ${testName}`, error as Error)

      updateTestResult(testId, {
        status,
        duration,
        error: errorMessage,
        response: undefined
      })

      if (isAborted) {
        message.warning(`${testName} was cancelled`)
        setCancelledRequests((prev) => [...prev, testId])
      } else {
        message.error(`${testName} failed: ${errorMessage}`)
      }

      throw error
    } finally {
      abortControllersRef.current.delete(testId)
    }
  }

  const cancelTest = (testId: string) => {
    const controller = abortControllersRef.current.get(testId)
    if (controller) {
      controller.abort()
      message.info(`Test ${testId} cancellation requested`)
    }
  }

  const cancelAllTests = () => {
    const controllers = Array.from(abortControllersRef.current.entries())
    controllers.forEach(([, controller]) => {
      controller.abort()
    })
    message.info(`${controllers.length} tests cancelled`)
  }

  // Request Cancellation Tests
  const testRequestCancellation = async () => {
    if (isRunning) return
    setIsRunning(true)

    try {
      // Note: Request cancellation is not supported with direct IPC
      // These tests demonstrate that cancellation attempts have no effect

      // Test 1: Attempt to "cancel" a slow request (will complete normally)
      await runAdvancedTest('cancel-slow', 'Slow Request (No Cancel Support)', 'cancellation', async () => {
        // Note: This will complete normally since cancellation is not supported
        return await dataApiService.post('/test/slow', { body: { delay: 1000 } })
      })

      // Test 2: Quick request (normal completion)
      await runAdvancedTest('cancel-quick', 'Quick Request Test', 'cancellation', async () => {
        return await dataApiService.get('/test/items')
      })

      // Test 3: Demonstrate that cancel methods exist but have no effect
      await runAdvancedTest('service-cancel', 'Cancel Method Test (No Effect)', 'cancellation', async () => {
        // These methods exist but log warnings and have no effect
        dataApiService.cancelRequest('dummy-id')
        dataApiService.cancelAllRequests()

        // Return successful test data
        return { cancelled: false, message: 'Cancel methods called but have no effect with direct IPC' }
      })
    } finally {
      setIsRunning(false)
    }
  }

  // Retry Mechanism Tests
  const testRetryMechanism = async () => {
    if (isRunning) return
    setIsRunning(true)

    try {
      // Configure retry settings for testing
      const originalConfig = dataApiService.getRetryConfig()
      const testConfig: RetryTestConfig = {
        maxRetries: 3,
        retryDelay: 500,
        backoffMultiplier: 2
      }

      dataApiService.configureRetry(testConfig)
      setRetryStats({ config: testConfig, attempts: [] })

      // Test 1: Network error retry
      await runAdvancedTest('retry-network', 'Network Error Retry Test', 'retry', async () => {
        try {
          return await dataApiService.post('/test/error', { body: { errorType: 'network' } })
        } catch (error) {
          return {
            retriedAndFailed: true,
            error: error instanceof Error ? error.message : 'Unknown error',
            message: 'Retry mechanism tested - expected to fail after retries'
          }
        }
      })

      // Test 2: Timeout retry
      await runAdvancedTest('retry-timeout', 'Timeout Error Retry Test', 'retry', async () => {
        try {
          return await dataApiService.post('/test/error', { body: { errorType: 'timeout' } })
        } catch (error) {
          return {
            retriedAndFailed: true,
            error: error instanceof Error ? error.message : 'Unknown error',
            message: 'Timeout retry tested - expected to fail after retries'
          }
        }
      })

      // Test 3: Server error retry
      await runAdvancedTest('retry-server', 'Server Error Retry Test', 'retry', async () => {
        try {
          return await dataApiService.post('/test/error', { body: { errorType: 'server' } })
        } catch (error) {
          return {
            retriedAndFailed: true,
            error: error instanceof Error ? error.message : 'Unknown error',
            message: 'Server error retry tested - expected to fail after retries'
          }
        }
      })

      // Restore original retry configuration
      dataApiService.configureRetry(originalConfig)
    } finally {
      setIsRunning(false)
    }
  }

  // Batch Operations Test
  const testBatchOperations = async () => {
    if (isRunning) return
    setIsRunning(true)

    try {
      // Test 1: Batch GET requests
      await runAdvancedTest('batch-get', 'Batch GET Requests', 'batch', async () => {
        const requests = [
          { method: 'GET', path: '/test/items', params: { page: 1, limit: 3 } },
          { method: 'GET', path: '/test/stats' },
          { method: 'GET', path: '/test/items', params: { page: 2, limit: 3 } }
        ]

        return await dataApiService.batch(
          requests.map((req, index) => ({
            id: `batch-get-${index}`,
            method: req.method as any,
            path: req.path,
            params: req.params
          })),
          { parallel: true }
        )
      })

      // Test 2: Mixed batch operations
      await runAdvancedTest('batch-mixed', 'Mixed Batch Operations', 'batch', async () => {
        const requests = [
          {
            id: 'batch-create-item',
            method: 'POST',
            path: '/test/items',
            body: {
              title: `Batch Created Item ${Date.now()}`,
              description: 'Created via batch operation',
              type: 'batch-test'
            }
          },
          {
            id: 'batch-get-items',
            method: 'GET',
            path: '/test/items',
            params: { page: 1, limit: 5 }
          }
        ]

        return await dataApiService.batch(requests as any, { parallel: false })
      })
    } finally {
      setIsRunning(false)
    }
  }

  // Error Handling Tests
  const testErrorHandling = async () => {
    if (isRunning) return
    setIsRunning(true)

    const errorTypes = ['notfound', 'validation', 'unauthorized', 'server', 'ratelimit']

    try {
      for (const errorType of errorTypes) {
        await runAdvancedTest(`error-${errorType}`, `Error Type: ${errorType.toUpperCase()}`, 'error', async () => {
          try {
            return await dataApiService.post('/test/error', { body: { errorType: errorType as any } })
          } catch (error) {
            return {
              errorTested: true,
              errorType,
              errorMessage: error instanceof Error ? error.message : 'Unknown error',
              message: `Successfully caught and handled ${errorType} error`
            }
          }
        })
      }
    } finally {
      setIsRunning(false)
    }
  }

  // Performance Tests
  const testPerformance = async () => {
    if (isRunning) return
    setIsRunning(true)

    try {
      const concurrentRequests = 10
      const stats = {
        concurrentRequests,
        totalTime: 0,
        averageTime: 0,
        successCount: 0,
        errorCount: 0,
        requests: [] as any[]
      }

      // Test concurrent requests
      await runAdvancedTest('perf-concurrent', `${concurrentRequests} Concurrent Requests`, 'performance', async () => {
        const startTime = Date.now()

        const promises = Array.from({ length: concurrentRequests }, (_, i) =>
          dataApiService.get('/test/items').then(
            (result) => ({ success: true, result, index: i }),
            (error) => ({ success: false, error: error instanceof Error ? error.message : 'Unknown error', index: i })
          )
        )

        const results = await Promise.all(promises)
        const totalTime = Date.now() - startTime

        stats.totalTime = totalTime
        stats.averageTime = totalTime / concurrentRequests
        stats.successCount = results.filter((r) => r.success).length
        stats.errorCount = results.filter((r) => !r.success).length
        stats.requests = results

        return stats
      })

      setPerformanceStats(stats)

      // Test memory usage
      await runAdvancedTest('perf-memory', 'Memory Usage Test', 'performance', async () => {
        const initialMemory = (performance as any).memory?.usedJSHeapSize || 0

        // Create many requests to test memory handling
        const largeRequests = Array.from({ length: 50 }, () => dataApiService.get('/test/items'))

        await Promise.allSettled(largeRequests)

        const finalMemory = (performance as any).memory?.usedJSHeapSize || 0
        const memoryIncrease = finalMemory - initialMemory

        return {
          initialMemory,
          finalMemory,
          memoryIncrease,
          memoryIncreaseKB: Math.round(memoryIncrease / 1024),
          message: `Memory increase: ${Math.round(memoryIncrease / 1024)}KB after 50 requests`
        }
      })
    } finally {
      setIsRunning(false)
    }
  }

  const resetTests = () => {
    // Cancel any running tests
    cancelAllTests()

    setTestResults([])
    setCancelledRequests([])
    setRetryStats(null)
    setPerformanceStats(null)
    setIsRunning(false)
    message.info('Advanced tests reset')
  }

  const getStatusColor = (status: AdvancedTestResult['status']) => {
    switch (status) {
      case 'success':
        return 'success'
      case 'error':
        return 'error'
      case 'cancelled':
        return 'warning'
      case 'running':
        return 'processing'
      default:
        return 'default'
    }
  }

  const getStatusIcon = (status: AdvancedTestResult['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle size={16} />
      case 'error':
        return <XCircle size={16} />
      case 'cancelled':
        return <StopCircle size={16} />
      case 'running':
        return <Activity size={16} className="animate-spin" />
      default:
        return <Clock size={16} />
    }
  }

  const getCategoryIcon = (category: AdvancedTestResult['category']) => {
    switch (category) {
      case 'cancellation':
        return <StopCircle size={16} />
      case 'retry':
        return <RotateCcw size={16} />
      case 'batch':
        return <Zap size={16} />
      case 'error':
        return <AlertTriangle size={16} />
      case 'performance':
        return <Timer size={16} />
      default:
        return <Activity size={16} />
    }
  }

  const tableColumns = [
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      render: (category: string) => (
        <Space>
          {getCategoryIcon(category as any)}
          <Text>{category}</Text>
        </Space>
      )
    },
    {
      title: 'Test',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => (
        <Text code style={{ fontSize: 12 }}>
          {name}
        </Text>
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: AdvancedTestResult['status']) => (
        <Tag color={getStatusColor(status)} icon={getStatusIcon(status)}>
          {status.toUpperCase()}
        </Tag>
      )
    },
    {
      title: 'Duration',
      dataIndex: 'duration',
      key: 'duration',
      render: (duration?: number) => (duration ? `${duration}ms` : '-')
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: AdvancedTestResult) => (
        <Space>
          {record.status === 'running' && (
            <Button
              size="small"
              type="text"
              danger
              icon={<StopCircle size={12} />}
              onClick={() => cancelTest(record.id)}>
              Cancel
            </Button>
          )}
        </Space>
      )
    }
  ]

  return (
    <TestContainer>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Control Panel */}
        <Card size="small">
          <Row gutter={16}>
            <Col span={6}>
              <Button
                type="primary"
                icon={<StopCircle size={16} />}
                onClick={testRequestCancellation}
                loading={isRunning}
                disabled={isRunning}
                block>
                Test Cancellation
              </Button>
            </Col>
            <Col span={6}>
              <Button
                type="primary"
                icon={<RotateCcw size={16} />}
                onClick={testRetryMechanism}
                loading={isRunning}
                disabled={isRunning}
                block>
                Test Retry
              </Button>
            </Col>
            <Col span={6}>
              <Button
                type="primary"
                icon={<Zap size={16} />}
                onClick={testBatchOperations}
                loading={isRunning}
                disabled={isRunning}
                block>
                Test Batch
              </Button>
            </Col>
            <Col span={6}>
              <Button
                type="primary"
                icon={<AlertTriangle size={16} />}
                onClick={testErrorHandling}
                loading={isRunning}
                disabled={isRunning}
                block>
                Test Errors
              </Button>
            </Col>
          </Row>

          <Row gutter={16} style={{ marginTop: 16 }}>
            <Col span={6}>
              <Button
                type="primary"
                icon={<Timer size={16} />}
                onClick={testPerformance}
                loading={isRunning}
                disabled={isRunning}
                block>
                Test Performance
              </Button>
            </Col>
            <Col span={6}>
              <Button icon={<Shield size={16} />} onClick={resetTests} disabled={isRunning} block>
                Reset Tests
              </Button>
            </Col>
            <Col span={12}>
              <Space style={{ float: 'right' }}>
                {abortControllersRef.current.size > 0 && (
                  <Button danger icon={<StopCircle size={16} />} onClick={cancelAllTests}>
                    Cancel All ({abortControllersRef.current.size})
                  </Button>
                )}
                <Text type="secondary">Running: {testResults.filter((t) => t.status === 'running').length}</Text>
              </Space>
            </Col>
          </Row>
        </Card>

        {/* Statistics */}
        <Row gutter={16}>
          <Col span={6}>
            <Card size="small">
              <Statistic title="Total Tests" value={testResults.length} prefix={<Activity size={16} />} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="Successful"
                value={testResults.filter((t) => t.status === 'success').length}
                prefix={<CheckCircle size={16} />}
                valueStyle={{ color: '#3f8600' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="Failed"
                value={testResults.filter((t) => t.status === 'error').length}
                prefix={<XCircle size={16} />}
                valueStyle={{ color: '#cf1322' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="Cancelled"
                value={testResults.filter((t) => t.status === 'cancelled').length}
                prefix={<StopCircle size={16} />}
                valueStyle={{ color: '#d48806' }}
              />
            </Card>
          </Col>
        </Row>

        {/* Performance Stats */}
        {performanceStats && (
          <Card title="Performance Statistics" size="small">
            <Row gutter={16}>
              <Col span={6}>
                <Statistic title="Concurrent Requests" value={performanceStats.concurrentRequests} />
              </Col>
              <Col span={6}>
                <Statistic title="Total Time" value={performanceStats.totalTime} suffix="ms" />
              </Col>
              <Col span={6}>
                <Statistic title="Average Time" value={Math.round(performanceStats.averageTime)} suffix="ms" />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Success Rate"
                  value={Math.round((performanceStats.successCount / performanceStats.concurrentRequests) * 100)}
                  suffix="%"
                />
              </Col>
            </Row>
          </Card>
        )}

        {/* Test Results Table */}
        <Card title="Advanced Test Results" size="small">
          {testResults.length === 0 ? (
            <Alert
              message="No advanced tests executed yet"
              description="Click any of the test buttons above to start testing advanced features"
              type="info"
              showIcon
            />
          ) : (
            <Table
              dataSource={testResults}
              columns={tableColumns}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 15 }}
              scroll={{ x: true }}
            />
          )}
        </Card>
      </Space>
    </TestContainer>
  )
}

const TestContainer = styled.div`
  .animate-spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
`

export default DataApiAdvancedTests
