import { useCache, usePersistCache, useSharedCache } from '@renderer/data/hooks/useCache'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { loggerService } from '@renderer/services/LoggerService'
import type { RendererPersistCacheKey } from '@shared/data/cache/cacheSchemas'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { Button, Card, Col, Divider, Input, message, Row, Select, Slider, Space, Typography } from 'antd'
import { Database, Edit, Eye, HardDrive, RefreshCw, Users, Zap } from 'lucide-react'
import React, { useRef, useState } from 'react'
import styled from 'styled-components'

const { Text } = Typography
const { Option } = Select

const logger = loggerService.withContext('CacheBasicTests')

/**
 * Basic cache hooks testing component
 * Tests useCache, useSharedCache, and usePersistCache hooks
 */
const CacheBasicTests: React.FC = () => {
  const [currentTheme] = usePreference('ui.theme_mode')
  const isDarkTheme = currentTheme === ThemeMode.dark

  // useCache testing
  const [memoryCacheKey, setMemoryCacheKey] = useState('test-hook-memory-1')
  const [memoryCacheDefault, setMemoryCacheDefault] = useState('default-memory-value')
  const [newMemoryValue, setNewMemoryValue] = useState('')
  const [memoryValue, setMemoryValue] = useCache(memoryCacheKey as any, memoryCacheDefault)

  // useSharedCache testing
  const [sharedCacheKey, setSharedCacheKey] = useState('test-hook-shared-1')
  const [sharedCacheDefault, setSharedCacheDefault] = useState('default-shared-value')
  const [newSharedValue, setNewSharedValue] = useState('')
  const [sharedValue, setSharedValue] = useSharedCache(sharedCacheKey as any, sharedCacheDefault)

  // usePersistCache testing
  const [persistCacheKey, setPersistCacheKey] = useState<RendererPersistCacheKey>('example-1')
  const [newPersistValue, setNewPersistValue] = useState('')
  const [persistValue, setPersistValue] = usePersistCache(persistCacheKey)

  // Testing different data types
  const [numberKey] = useState('test-number-cache' as const)
  const [numberValue, setNumberValue] = useCache(numberKey as any, 42)

  const [objectKey] = useState('test-object-cache' as const)
  const [objectValue, setObjectValue] = useCache(objectKey as any, { name: 'test', count: 0, active: true })

  // Stats
  const renderCountRef = useRef(0)
  const [displayRenderCount, setDisplayRenderCount] = useState(0)
  const [updateCount, setUpdateCount] = useState(0)

  // Available persist keys
  const persistKeys: RendererPersistCacheKey[] = ['example-1', 'example-2', 'example-3', 'example-4']

  // Update render count without causing re-renders
  renderCountRef.current += 1

  const parseValue = (value: string): any => {
    if (!value) return undefined
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }

  const formatValue = (value: any): string => {
    if (value === undefined) return 'undefined'
    if (value === null) return 'null'
    if (typeof value === 'string') return `"${value}"`
    return JSON.stringify(value, null, 2)
  }

  // Memory cache operations
  const handleMemoryUpdate = () => {
    try {
      const parsed = parseValue(newMemoryValue)
      setMemoryValue(parsed)
      setNewMemoryValue('')
      setUpdateCount((prev) => prev + 1)
      message.success(`Memory cache updated: ${memoryCacheKey}`)
      logger.info('Memory cache updated via hook', { key: memoryCacheKey, value: parsed })
    } catch (error) {
      message.error(`Memory cache update failed: ${(error as Error).message}`)
    }
  }

  // Shared cache operations
  const handleSharedUpdate = () => {
    try {
      const parsed = parseValue(newSharedValue)
      setSharedValue(parsed)
      setNewSharedValue('')
      setUpdateCount((prev) => prev + 1)
      message.success(`Shared cache updated: ${sharedCacheKey} (broadcasted to other windows)`)
      logger.info('Shared cache updated via hook', { key: sharedCacheKey, value: parsed })
    } catch (error) {
      message.error(`Shared cache update failed: ${(error as Error).message}`)
    }
  }

  // Persist cache operations
  const handlePersistUpdate = () => {
    try {
      let parsed: any
      // Handle different types based on schema
      if (persistCacheKey === 'example-1') {
        parsed = newPersistValue // string
      } else if (persistCacheKey === 'example-2') {
        parsed = parseInt(newPersistValue) || 0 // number
      } else if (persistCacheKey === 'example-3') {
        parsed = newPersistValue === 'true' // boolean
      } else if (persistCacheKey === 'example-4') {
        parsed = parseValue(newPersistValue) // object
      }

      setPersistValue(parsed as any)
      setNewPersistValue('')
      setUpdateCount((prev) => prev + 1)
      message.success(`Persist cache updated: ${persistCacheKey} (saved + broadcasted)`)
      logger.info('Persist cache updated via hook', { key: persistCacheKey, value: parsed })
    } catch (error) {
      message.error(`Persist cache update failed: ${(error as Error).message}`)
    }
  }

  // Test different data types
  const handleNumberUpdate = (newValue: number) => {
    setNumberValue(newValue)
    setUpdateCount((prev) => prev + 1)
    logger.info('Number cache updated', { value: newValue })
  }

  const handleObjectUpdate = (field: string, value: any) => {
    const currentValue = objectValue || { name: 'test', count: 0, active: true }
    setObjectValue({ ...currentValue, [field]: value })
    setUpdateCount((prev) => prev + 1)
    logger.info('Object cache updated', { field, value })
  }

  return (
    <TestContainer $isDark={isDarkTheme}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <Space>
            <Text type="secondary">
              React Hook Tests • Renders: {displayRenderCount || renderCountRef.current} • Updates: {updateCount}
            </Text>
            <Button
              size="small"
              onClick={() => {
                renderCountRef.current = 0
                setDisplayRenderCount(0)
                setUpdateCount(0)
              }}>
              Reset Stats
            </Button>
          </Space>
        </div>

        <Row gutter={[16, 16]}>
          {/* useCache Testing */}
          <Col span={8}>
            <Card
              title={
                <Space>
                  <Zap size={16} />
                  <Text>useCache Hook</Text>
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
                  value={memoryCacheKey}
                  onChange={(e) => setMemoryCacheKey(e.target.value)}
                  prefix={<Database size={14} />}
                />

                <Input
                  placeholder="Default Value"
                  value={memoryCacheDefault}
                  onChange={(e) => setMemoryCacheDefault(e.target.value)}
                  prefix={<Eye size={14} />}
                />

                <Input
                  placeholder="New Value"
                  value={newMemoryValue}
                  onChange={(e) => setNewMemoryValue(e.target.value)}
                  onPressEnter={handleMemoryUpdate}
                  prefix={<Edit size={14} />}
                />

                <Button type="primary" onClick={handleMemoryUpdate} disabled={!newMemoryValue} block>
                  Update Memory Cache
                </Button>

                <ResultDisplay $isDark={isDarkTheme}>
                  <Text strong>Current Value:</Text>
                  <pre>{formatValue(memoryValue)}</pre>
                </ResultDisplay>
              </Space>
            </Card>
          </Col>

          {/* useSharedCache Testing */}
          <Col span={8}>
            <Card
              title={
                <Space>
                  <Users size={16} />
                  <Text>useSharedCache Hook</Text>
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
                  value={sharedCacheKey}
                  onChange={(e) => setSharedCacheKey(e.target.value)}
                  prefix={<Database size={14} />}
                />

                <Input
                  placeholder="Default Value"
                  value={sharedCacheDefault}
                  onChange={(e) => setSharedCacheDefault(e.target.value)}
                  prefix={<Eye size={14} />}
                />

                <Input
                  placeholder="New Value"
                  value={newSharedValue}
                  onChange={(e) => setNewSharedValue(e.target.value)}
                  onPressEnter={handleSharedUpdate}
                  prefix={<Edit size={14} />}
                />

                <Button type="primary" onClick={handleSharedUpdate} disabled={!newSharedValue} block>
                  Update Shared Cache
                </Button>

                <ResultDisplay $isDark={isDarkTheme}>
                  <Text strong>Current Value:</Text>
                  <pre>{formatValue(sharedValue)}</pre>
                </ResultDisplay>
              </Space>
            </Card>
          </Col>

          {/* usePersistCache Testing */}
          <Col span={8}>
            <Card
              title={
                <Space>
                  <HardDrive size={16} />
                  <Text>usePersistCache Hook</Text>
                </Space>
              }
              size="small"
              style={{
                backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff',
                borderColor: isDarkTheme ? '#303030' : '#d9d9d9'
              }}>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Select
                  value={persistCacheKey}
                  onChange={setPersistCacheKey}
                  style={{ width: '100%' }}
                  placeholder="Select persist key">
                  {persistKeys.map((key) => (
                    <Option key={key} value={key}>
                      {key}
                    </Option>
                  ))}
                </Select>

                <Input
                  placeholder="New Value"
                  value={newPersistValue}
                  onChange={(e) => setNewPersistValue(e.target.value)}
                  onPressEnter={handlePersistUpdate}
                  prefix={<Edit size={14} />}
                />

                <Button type="primary" onClick={handlePersistUpdate} disabled={!newPersistValue} block>
                  Update Persist Cache
                </Button>

                <ResultDisplay $isDark={isDarkTheme}>
                  <Text strong>Current Value:</Text>
                  <pre>{formatValue(persistValue)}</pre>
                </ResultDisplay>
              </Space>
            </Card>
          </Col>
        </Row>

        <Divider />

        {/* Data Type Testing */}
        <Row gutter={[16, 16]}>
          <Col span={12}>
            <Card
              title={
                <Space>
                  <RefreshCw size={16} />
                  <Text>Number Type Testing</Text>
                </Space>
              }
              size="small"
              style={{
                backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff',
                borderColor: isDarkTheme ? '#303030' : '#d9d9d9'
              }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text>
                  Key: <code>{numberKey}</code>
                </Text>
                <Text>
                  Current Value: <strong>{numberValue}</strong>
                </Text>

                <Slider
                  min={0}
                  max={100}
                  value={typeof numberValue === 'number' ? numberValue : 42}
                  onChange={handleNumberUpdate}
                />

                <Space>
                  <Button size="small" onClick={() => handleNumberUpdate(0)}>
                    Reset to 0
                  </Button>
                  <Button size="small" onClick={() => handleNumberUpdate(Math.floor(Math.random() * 100))}>
                    Random
                  </Button>
                </Space>
              </Space>
            </Card>
          </Col>

          <Col span={12}>
            <Card
              title={
                <Space>
                  <Database size={16} />
                  <Text>Object Type Testing</Text>
                </Space>
              }
              size="small"
              style={{
                backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff',
                borderColor: isDarkTheme ? '#303030' : '#d9d9d9'
              }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text>
                  Key: <code>{objectKey}</code>
                </Text>

                <Space>
                  <Input
                    placeholder="Name"
                    value={objectValue?.name || ''}
                    onChange={(e) => handleObjectUpdate('name', e.target.value)}
                    style={{ width: 120 }}
                  />
                  <Input
                    placeholder="Count"
                    type="number"
                    value={objectValue?.count || 0}
                    onChange={(e) => handleObjectUpdate('count', parseInt(e.target.value) || 0)}
                    style={{ width: 80 }}
                  />
                  <Button
                    type={objectValue?.active ? 'primary' : 'default'}
                    onClick={() => handleObjectUpdate('active', !objectValue?.active)}>
                    {objectValue?.active ? 'Active' : 'Inactive'}
                  </Button>
                </Space>

                <ResultDisplay $isDark={isDarkTheme}>
                  <pre>{formatValue(objectValue)}</pre>
                </ResultDisplay>
              </Space>
            </Card>
          </Col>
        </Row>

        <div style={{ textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            💡 提示: useCache 仅在当前窗口有效 • useSharedCache 跨窗口实时同步 • usePersistCache 类型安全的持久化存储
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
  max-height: 100px;
  overflow-y: auto;

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    color: ${(props) => (props.$isDark ? '#e6edf3' : '#1f2328')};
    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
  }
`

export default CacheBasicTests
