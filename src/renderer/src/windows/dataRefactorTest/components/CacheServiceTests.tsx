import { cacheService } from '@renderer/data/CacheService'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { loggerService } from '@renderer/services/LoggerService'
import type { RendererPersistCacheKey, RendererPersistCacheSchema } from '@shared/data/cache/cacheSchemas'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { Button, Card, Col, Divider, Input, message, Row, Select, Space, Typography } from 'antd'
import { Clock, Database, Edit, Eye, Trash2, Zap } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import styled from 'styled-components'

const { Text } = Typography
const { Option } = Select
const { TextArea } = Input

const logger = loggerService.withContext('CacheServiceTests')

/**
 * Direct CacheService API testing component
 * Tests memory, shared, and persist cache operations
 */
const CacheServiceTests: React.FC = () => {
  const [currentTheme] = usePreference('ui.theme_mode')
  const isDarkTheme = currentTheme === ThemeMode.dark

  // State for test operations
  const [memoryKey, setMemoryKey] = useState('test-memory-1')
  const [memoryValue, setMemoryValue] = useState('{"type": "memory", "data": "test"}')
  const [memoryTTL, setMemoryTTL] = useState<string>('5000')

  const [sharedKey, setSharedKey] = useState('test-shared-1')
  const [sharedValue, setSharedValue] = useState('{"type": "shared", "data": "cross-window"}')
  const [sharedTTL, setSharedTTL] = useState<string>('10000')

  const [persistKey, setPersistKey] = useState<RendererPersistCacheKey>('example-1')
  const [persistValue, setPersistValue] = useState('updated-example-value')

  // Display states
  const [memoryResult, setMemoryResult] = useState<any>(null)
  const [sharedResult, setSharedResult] = useState<any>(null)
  const [persistResult, setPersistResult] = useState<any>(null)

  const [updateCount, setUpdateCount] = useState(0)

  // Available persist keys from schema
  const persistKeys: RendererPersistCacheKey[] = ['example-1', 'example-2', 'example-3', 'example-4']

  const parseValue = (value: string): any => {
    if (!value) return undefined
    try {
      return JSON.parse(value)
    } catch {
      return value // Return as string if not valid JSON
    }
  }

  const formatValue = (value: any): string => {
    if (value === undefined) return 'undefined'
    if (value === null) return 'null'
    if (typeof value === 'string') return `"${value}"`
    return JSON.stringify(value, null, 2)
  }

  // Memory Cache Operations
  const handleMemorySet = () => {
    try {
      const parsed = parseValue(memoryValue)
      const ttl = memoryTTL ? parseInt(memoryTTL) : undefined
      cacheService.set(memoryKey, parsed, ttl)
      message.success(`Memory cache set: ${memoryKey}`)
      setUpdateCount((prev) => prev + 1)
      logger.info('Memory cache set', { key: memoryKey, value: parsed, ttl })
    } catch (error) {
      message.error(`Memory cache set failed: ${(error as Error).message}`)
      logger.error('Memory cache set failed', error as Error)
    }
  }

  const handleMemoryGet = () => {
    try {
      const result = cacheService.get(memoryKey)
      setMemoryResult(result)
      message.info(`Memory cache get: ${memoryKey}`)
      logger.info('Memory cache get', { key: memoryKey, result })
    } catch (error) {
      message.error(`Memory cache get failed: ${(error as Error).message}`)
      logger.error('Memory cache get failed', error as Error)
    }
  }

  const handleMemoryHas = () => {
    try {
      const exists = cacheService.has(memoryKey)
      message.info(`Memory cache has ${memoryKey}: ${exists}`)
      logger.info('Memory cache has', { key: memoryKey, exists })
    } catch (error) {
      message.error(`Memory cache has failed: ${(error as Error).message}`)
    }
  }

  const handleMemoryDelete = () => {
    try {
      const deleted = cacheService.delete(memoryKey)
      message.info(`Memory cache delete ${memoryKey}: ${deleted}`)
      setMemoryResult(undefined)
      logger.info('Memory cache delete', { key: memoryKey, deleted })
    } catch (error) {
      message.error(`Memory cache delete failed: ${(error as Error).message}`)
    }
  }

  // Shared Cache Operations
  const handleSharedSet = () => {
    try {
      const parsed = parseValue(sharedValue)
      const ttl = sharedTTL ? parseInt(sharedTTL) : undefined
      cacheService.setShared(sharedKey, parsed, ttl)
      message.success(`Shared cache set: ${sharedKey} (broadcasted to other windows)`)
      setUpdateCount((prev) => prev + 1)
      logger.info('Shared cache set', { key: sharedKey, value: parsed, ttl })
    } catch (error) {
      message.error(`Shared cache set failed: ${(error as Error).message}`)
      logger.error('Shared cache set failed', error as Error)
    }
  }

  const handleSharedGet = () => {
    try {
      const result = cacheService.getShared(sharedKey)
      setSharedResult(result)
      message.info(`Shared cache get: ${sharedKey}`)
      logger.info('Shared cache get', { key: sharedKey, result })
    } catch (error) {
      message.error(`Shared cache get failed: ${(error as Error).message}`)
      logger.error('Shared cache get failed', error as Error)
    }
  }

  const handleSharedHas = () => {
    try {
      const exists = cacheService.hasShared(sharedKey)
      message.info(`Shared cache has ${sharedKey}: ${exists}`)
      logger.info('Shared cache has', { key: sharedKey, exists })
    } catch (error) {
      message.error(`Shared cache has failed: ${(error as Error).message}`)
    }
  }

  const handleSharedDelete = () => {
    try {
      const deleted = cacheService.deleteShared(sharedKey)
      message.info(`Shared cache delete ${sharedKey}: ${deleted} (broadcasted to other windows)`)
      setSharedResult(undefined)
      logger.info('Shared cache delete', { key: sharedKey, deleted })
    } catch (error) {
      message.error(`Shared cache delete failed: ${(error as Error).message}`)
    }
  }

  // Persist Cache Operations
  const handlePersistSet = () => {
    try {
      let parsed: any
      // Handle different types based on the schema
      if (persistKey === 'example-1') {
        parsed = persistValue // string
      } else if (persistKey === 'example-2') {
        parsed = parseInt(persistValue) || 0 // number
      } else if (persistKey === 'example-3') {
        parsed = persistValue === 'true' // boolean
      } else if (persistKey === 'example-4') {
        parsed = parseValue(persistValue) // object
      }

      cacheService.setPersist(persistKey, parsed as RendererPersistCacheSchema[typeof persistKey])
      message.success(`Persist cache set: ${persistKey} (saved to localStorage + broadcasted)`)
      setUpdateCount((prev) => prev + 1)
      logger.info('Persist cache set', { key: persistKey, value: parsed })
    } catch (error) {
      message.error(`Persist cache set failed: ${(error as Error).message}`)
      logger.error('Persist cache set failed', error as Error)
    }
  }

  const handlePersistGet = () => {
    try {
      const result = cacheService.getPersist(persistKey)
      setPersistResult(result)
      message.info(`Persist cache get: ${persistKey}`)
      logger.info('Persist cache get', { key: persistKey, result })
    } catch (error) {
      message.error(`Persist cache get failed: ${(error as Error).message}`)
      logger.error('Persist cache get failed', error as Error)
    }
  }

  const handlePersistHas = () => {
    try {
      const exists = cacheService.hasPersist(persistKey)
      message.info(`Persist cache has ${persistKey}: ${exists}`)
      logger.info('Persist cache has', { key: persistKey, exists })
    } catch (error) {
      message.error(`Persist cache has failed: ${(error as Error).message}`)
    }
  }

  // Auto-refresh results
  useEffect(() => {
    const interval = setInterval(() => {
      // Auto-get current values for display
      try {
        const memResult = cacheService.get(memoryKey)
        const sharedResult = cacheService.getShared(sharedKey)
        const persistResult = cacheService.getPersist(persistKey)

        setMemoryResult(memResult)
        setSharedResult(sharedResult)
        setPersistResult(persistResult)
      } catch (error) {
        logger.error('Auto-refresh failed', error as Error)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [memoryKey, sharedKey, persistKey])

  return (
    <TestContainer $isDark={isDarkTheme}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <Text type="secondary">直接测试 CacheService API • Updates: {updateCount} • Auto-refresh: 1s</Text>
        </div>

        <Row gutter={[16, 16]}>
          {/* Memory Cache Section */}
          <Col span={8}>
            <Card
              title={
                <Space>
                  <Zap size={16} />
                  <Text>Memory Cache</Text>
                </Space>
              }
              size="small"
              style={{
                backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff',
                borderColor: isDarkTheme ? '#303030' : '#d9d9d9'
              }}>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Input
                  placeholder="Cache Key"
                  value={memoryKey}
                  onChange={(e) => setMemoryKey(e.target.value)}
                  prefix={<Database size={14} />}
                />

                <TextArea
                  placeholder="Value (JSON or string)"
                  value={memoryValue}
                  onChange={(e) => setMemoryValue(e.target.value)}
                  rows={2}
                />

                <Input
                  placeholder="TTL (ms, optional)"
                  value={memoryTTL}
                  onChange={(e) => setMemoryTTL(e.target.value)}
                  prefix={<Clock size={14} />}
                />

                <Space size="small" wrap>
                  <Button size="small" type="primary" onClick={handleMemorySet} icon={<Edit size={12} />}>
                    Set
                  </Button>
                  <Button size="small" onClick={handleMemoryGet} icon={<Eye size={12} />}>
                    Get
                  </Button>
                  <Button size="small" onClick={handleMemoryHas} icon={<Database size={12} />}>
                    Has
                  </Button>
                  <Button size="small" danger onClick={handleMemoryDelete} icon={<Trash2 size={12} />}>
                    Delete
                  </Button>
                </Space>

                <ResultDisplay $isDark={isDarkTheme}>
                  <Text strong>Result:</Text>
                  <pre>{formatValue(memoryResult)}</pre>
                </ResultDisplay>
              </Space>
            </Card>
          </Col>

          {/* Shared Cache Section */}
          <Col span={8}>
            <Card
              title={
                <Space>
                  <Database size={16} />
                  <Text>Shared Cache</Text>
                </Space>
              }
              size="small"
              style={{
                backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff',
                borderColor: isDarkTheme ? '#303030' : '#d9d9d9'
              }}>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Input
                  placeholder="Cache Key"
                  value={sharedKey}
                  onChange={(e) => setSharedKey(e.target.value)}
                  prefix={<Database size={14} />}
                />

                <TextArea
                  placeholder="Value (JSON or string)"
                  value={sharedValue}
                  onChange={(e) => setSharedValue(e.target.value)}
                  rows={2}
                />

                <Input
                  placeholder="TTL (ms, optional)"
                  value={sharedTTL}
                  onChange={(e) => setSharedTTL(e.target.value)}
                  prefix={<Clock size={14} />}
                />

                <Space size="small" wrap>
                  <Button size="small" type="primary" onClick={handleSharedSet} icon={<Edit size={12} />}>
                    Set
                  </Button>
                  <Button size="small" onClick={handleSharedGet} icon={<Eye size={12} />}>
                    Get
                  </Button>
                  <Button size="small" onClick={handleSharedHas} icon={<Database size={12} />}>
                    Has
                  </Button>
                  <Button size="small" danger onClick={handleSharedDelete} icon={<Trash2 size={12} />}>
                    Delete
                  </Button>
                </Space>

                <ResultDisplay $isDark={isDarkTheme}>
                  <Text strong>Result:</Text>
                  <pre>{formatValue(sharedResult)}</pre>
                </ResultDisplay>
              </Space>
            </Card>
          </Col>

          {/* Persist Cache Section */}
          <Col span={8}>
            <Card
              title={
                <Space>
                  <Eye size={16} />
                  <Text>Persist Cache</Text>
                </Space>
              }
              size="small"
              style={{
                backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff',
                borderColor: isDarkTheme ? '#303030' : '#d9d9d9'
              }}>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Select
                  value={persistKey}
                  onChange={setPersistKey}
                  style={{ width: '100%' }}
                  placeholder="Select persist key">
                  {persistKeys.map((key) => (
                    <Option key={key} value={key}>
                      {key}
                    </Option>
                  ))}
                </Select>

                <TextArea
                  placeholder="Value (type depends on key)"
                  value={persistValue}
                  onChange={(e) => setPersistValue(e.target.value)}
                  rows={2}
                />

                <Space size="small" wrap>
                  <Button size="small" type="primary" onClick={handlePersistSet} icon={<Edit size={12} />}>
                    Set
                  </Button>
                  <Button size="small" onClick={handlePersistGet} icon={<Eye size={12} />}>
                    Get
                  </Button>
                  <Button size="small" onClick={handlePersistHas} icon={<Database size={12} />}>
                    Has
                  </Button>
                </Space>

                <ResultDisplay $isDark={isDarkTheme}>
                  <Text strong>Result:</Text>
                  <pre>{formatValue(persistResult)}</pre>
                </ResultDisplay>
              </Space>
            </Card>
          </Col>
        </Row>

        <Divider />

        <div style={{ textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            💡 提示: Memory cache 仅在当前窗口有效 • Shared cache 跨窗口同步 • Persist cache 持久化到 localStorage
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

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    color: ${(props) => (props.$isDark ? '#e6edf3' : '#1f2328')};
    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
  }
`

export default CacheServiceTests
