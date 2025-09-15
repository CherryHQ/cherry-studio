import { usePreference } from '@renderer/data/hooks/usePreference'
import { preferenceService } from '@renderer/data/PreferenceService'
import { type PreferenceKeyType, ThemeMode } from '@shared/data/preference/preferenceTypes'
import { Button, Input, message, Space, Typography } from 'antd'
import React, { useState } from 'react'
import styled from 'styled-components'

const { Text } = Typography

/**
 * PreferenceService direct API testing component
 * Tests the service layer functionality without React hooks
 */
const PreferenceServiceTests: React.FC = () => {
  const [testKey, setTestKey] = useState<string>('ui.theme_mode')
  const [testValue, setTestValue] = useState<string>(ThemeMode.dark)
  const [getResult, setGetResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  // Theme monitoring for visual changes
  const [currentTheme] = usePreference('ui.theme_mode')
  const isDarkTheme = currentTheme === ThemeMode.dark

  const handleGet = async () => {
    try {
      setLoading(true)
      const result = await preferenceService.get(testKey as PreferenceKeyType)
      setGetResult(result)
      message.success('获取成功')
    } catch (error) {
      message.error(`获取失败: ${(error as Error).message}`)
      setGetResult(`Error: ${(error as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleSet = async () => {
    try {
      setLoading(true)
      let parsedValue: any = testValue

      // Try to parse as JSON if it looks like an object/array/boolean/number
      if (
        testValue.startsWith('{') ||
        testValue.startsWith('[') ||
        testValue === 'true' ||
        testValue === 'false' ||
        !isNaN(Number(testValue))
      ) {
        try {
          parsedValue = JSON.parse(testValue)
        } catch {
          // Keep as string if JSON parsing fails
        }
      }

      await preferenceService.set(testKey as PreferenceKeyType, parsedValue)
      message.success('设置成功')
      // Automatically get the updated value
      await handleGet()
    } catch (error) {
      message.error(`设置失败: ${(error as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleGetCached = () => {
    try {
      const result = preferenceService.getCachedValue(testKey as PreferenceKeyType)
      setGetResult(result !== undefined ? result : 'undefined (not cached)')
      message.info('获取缓存值成功')
    } catch (error) {
      message.error(`获取缓存失败: ${(error as Error).message}`)
      setGetResult(`Error: ${(error as Error).message}`)
    }
  }

  const handleIsCached = () => {
    try {
      const result = preferenceService.isCached(testKey as PreferenceKeyType)
      setGetResult(result ? 'true (已缓存)' : 'false (未缓存)')
      message.info('检查缓存状态成功')
    } catch (error) {
      message.error(`检查缓存失败: ${(error as Error).message}`)
    }
  }

  const handlePreload = async () => {
    try {
      setLoading(true)
      await preferenceService.preload([testKey as PreferenceKeyType])
      message.success('预加载成功')
      await handleGet()
    } catch (error) {
      message.error(`预加载失败: ${(error as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleGetAll = async () => {
    try {
      setLoading(true)
      // Use loadAll to get all preferences at once
      const result = await preferenceService.preloadAll()
      setGetResult(`All preferences (${Object.keys(result).length} keys):\n${JSON.stringify(result, null, 2)}`)
      message.success('获取所有偏好设置成功')
    } catch (error) {
      message.error(`获取偏好设置失败: ${(error as Error).message}`)
      setGetResult(`Error: ${(error as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <TestContainer isDark={isDarkTheme}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {/* Input Controls */}
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <div>
            <Text strong>Preference Key:</Text>
            <Input
              value={testKey}
              onChange={(e) => setTestKey(e.target.value)}
              placeholder="Enter preference key (e.g., app.theme)"
              style={{ marginTop: 4 }}
            />
          </div>
          <div>
            <Text strong>Value:</Text>
            <Input
              value={testValue}
              onChange={(e) => setTestValue(e.target.value)}
              placeholder="Enter value (JSON format for objects/arrays)"
              style={{ marginTop: 4 }}
            />
          </div>
        </Space>

        {/* Action Buttons */}
        <Space wrap>
          <Button type="primary" onClick={handleGet} loading={loading}>
            Get
          </Button>
          <Button onClick={handleSet} loading={loading}>
            Set
          </Button>
          <Button onClick={handleGetCached}>Get Cached</Button>
          <Button onClick={handleIsCached}>Is Cached</Button>
          <Button onClick={handlePreload} loading={loading}>
            Preload
          </Button>
          <Button onClick={handleGetAll} loading={loading}>
            Load All
          </Button>
        </Space>

        {/* Result Display */}
        {getResult !== null && (
          <ResultContainer isDark={isDarkTheme}>
            <Text strong>Result:</Text>
            <ResultText>
              {typeof getResult === 'object' ? JSON.stringify(getResult, null, 2) : String(getResult)}
            </ResultText>
          </ResultContainer>
        )}

        {/* Quick Test Buttons */}
        <Space wrap>
          <Button
            size="small"
            onClick={() => {
              setTestKey('ui.theme_mode')
              setTestValue(ThemeMode.dark)
            }}>
            Test: ui.theme_mode
          </Button>
          <Button
            size="small"
            onClick={() => {
              setTestKey('app.language')
              setTestValue('zh-CN')
            }}>
            Test: app.language
          </Button>
          <Button
            size="small"
            onClick={() => {
              setTestKey('app.spell_check.enabled')
              setTestValue('true')
            }}>
            Test: app.spell_check.enabled
          </Button>
        </Space>
      </Space>
    </TestContainer>
  )
}

const TestContainer = styled.div<{ isDark: boolean }>`
  padding: 16px;
  background: ${(props) => (props.isDark ? '#262626' : '#fafafa')};
  border-radius: 8px;

  .ant-typography {
    color: ${(props) => (props.isDark ? '#fff' : 'inherit')} !important;
  }

  .ant-input {
    background-color: ${(props) => (props.isDark ? '#1f1f1f' : '#fff')} !important;
    border-color: ${(props) => (props.isDark ? '#434343' : '#d9d9d9')} !important;
    color: ${(props) => (props.isDark ? '#fff' : '#000')} !important;
  }
`

const ResultContainer = styled.div<{ isDark?: boolean }>`
  margin-top: 16px;
  padding: 12px;
  background: ${(props) => (props.isDark ? '#1f1f1f' : '#f0f0f0')};
  border-radius: 6px;
  border-left: 4px solid var(--color-primary);
`

const ResultText = styled.pre`
  margin: 8px 0 0 0;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #333;
  white-space: pre-wrap;
  word-break: break-all;
`

export default PreferenceServiceTests
