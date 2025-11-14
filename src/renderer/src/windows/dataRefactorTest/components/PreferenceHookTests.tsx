import { usePreference } from '@renderer/data/hooks/usePreference'
import { preferenceService } from '@renderer/data/PreferenceService'
import { loggerService } from '@renderer/services/LoggerService'
import { type PreferenceKeyType, ThemeMode } from '@shared/data/preference/preferenceTypes'
import { Button, Card, message, Space, Typography } from 'antd'
import React, { useState } from 'react'
import styled from 'styled-components'

const { Text } = Typography

const logger = loggerService.withContext('PreferenceHookTests')

/**
 * Advanced usePreference hook testing component
 * Tests preloading, service access, and hook behavior
 */
const PreferenceHookTests: React.FC = () => {
  const [subscriptionCount, setSubscriptionCount] = useState(0)

  // Test multiple hooks with same key
  const [theme1] = usePreference('ui.theme_mode')
  const [theme2] = usePreference('ui.theme_mode')
  const [language] = usePreference('app.language')

  // Manual preload implementation using useEffect
  React.useEffect(() => {
    const preloadKeys: PreferenceKeyType[] = ['ui.theme_mode', 'app.language', 'app.zoom_factor']
    preferenceService.preload(preloadKeys).catch((error) => {
      logger.error('Failed to preload preferences:', error as Error)
    })
  }, [])

  // Use useRef to track render count without causing re-renders
  const renderCountRef = React.useRef(0)
  renderCountRef.current += 1

  const testSubscriptions = () => {
    // Test subscription behavior
    const unsubscribe = preferenceService.subscribeChange('ui.theme_mode')(() => {
      setSubscriptionCount((prev) => prev + 1)
    })

    message.info('已添加订阅，修改app.theme.mode将触发计数')

    // Clean up after 10 seconds
    setTimeout(() => {
      unsubscribe()
      message.info('订阅已取消')
    }, 10000)
  }

  const testCacheWarming = async () => {
    try {
      const keys: PreferenceKeyType[] = ['ui.theme_mode', 'app.language', 'app.zoom_factor', 'app.spell_check.enabled']
      await preferenceService.preload(keys)

      const cachedStates = keys.map((key) => ({
        key,
        isCached: preferenceService.isCached(key),
        value: preferenceService.getCachedValue(key)
      }))

      message.success(`预加载完成。缓存状态: ${cachedStates.filter((s) => s.isCached).length}/${keys.length}`)
      logger.debug('Cache states:', { cachedStates })
    } catch (error) {
      message.error(`预加载失败: ${(error as Error).message}`)
    }
  }

  const testBatchOperations = async () => {
    try {
      const keys: PreferenceKeyType[] = ['ui.theme_mode', 'app.language']
      const result = await preferenceService.getMultipleRaw(keys)

      message.success(`批量获取成功: ${Object.keys(result).length} 项`)
      logger.debug('Batch get result:', { result })

      // Test batch set
      await preferenceService.setMultiple({
        'ui.theme_mode': theme1 === ThemeMode.dark ? ThemeMode.light : ThemeMode.dark,
        'app.language': language === 'zh-CN' ? 'en-US' : 'zh-CN'
      })

      message.success('批量设置成功')
    } catch (error) {
      message.error(`批量操作失败: ${(error as Error).message}`)
    }
  }

  const performanceTest = async () => {
    const start = performance.now()
    const iterations = 100

    try {
      // Test rapid reads
      for (let i = 0; i < iterations; i++) {
        preferenceService.getCachedValue('ui.theme_mode')
      }

      const readTime = performance.now() - start

      // Test rapid writes
      const writeStart = performance.now()
      for (let i = 0; i < 10; i++) {
        await preferenceService.set(
          'ui.theme_mode',
          i % 3 === 0 ? ThemeMode.light : i % 3 === 1 ? ThemeMode.dark : ThemeMode.system
        )
      }
      const writeTime = performance.now() - writeStart

      message.success(
        `性能测试完成: 读取${iterations}次耗时${readTime.toFixed(2)}ms, 写入10次耗时${writeTime.toFixed(2)}ms`
      )
    } catch (error) {
      message.error(`性能测试失败: ${(error as Error).message}`)
    }
  }

  return (
    <TestContainer>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {/* Hook State Display */}
        <Card size="small" title="Hook 状态监控">
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Text>
              组件渲染次数: <Text strong>{renderCountRef.current}</Text>
            </Text>
            <Text>
              订阅触发次数: <Text strong>{subscriptionCount}</Text>
            </Text>
            <Text>
              Theme Hook 1: <Text code>{String(theme1)}</Text>
            </Text>
            <Text>
              Theme Hook 2: <Text code>{String(theme2)}</Text>
            </Text>
            <Text>
              Language Hook: <Text code>{String(language)}</Text>
            </Text>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              注意: 相同key的多个hook应该返回相同值
            </Text>
          </Space>
        </Card>

        {/* Test Actions */}
        <Space wrap>
          <Button onClick={testSubscriptions}>测试订阅机制</Button>
          <Button onClick={testCacheWarming}>测试缓存预热</Button>
          <Button onClick={testBatchOperations}>测试批量操作</Button>
          <Button onClick={performanceTest}>性能测试</Button>
        </Space>

        {/* Service Information */}
        <Card size="small" title="Service 信息">
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Text>
              Service实例: <Text code>{preferenceService ? '已连接' : '未连接'}</Text>
            </Text>
            <Text>预加载Keys: ui.theme_mode, app.language, app.zoom_factor</Text>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              usePreferenceService() 返回的是同一个单例实例
            </Text>
          </Space>
        </Card>

        {/* Hook Behavior Tests */}
        <Card size="small" title="Hook 行为测试">
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Text strong>实时同步测试:</Text>
            <Text type="secondary">1. 在其他测试组件中修改 ui.theme_mode 或 app.language</Text>
            <Text type="secondary">2. 观察此组件中的值是否实时更新</Text>
            <Text type="secondary">3. 检查订阅触发次数是否增加</Text>
          </Space>
        </Card>
      </Space>
    </TestContainer>
  )
}

const TestContainer = styled.div`
  padding: 16px;
  background: #fafafa;
  border-radius: 8px;
`

export default PreferenceHookTests
