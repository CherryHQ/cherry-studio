# Test Mocks

这个目录包含了项目中使用的统一测试模拟（mocks）。这些模拟按照进程类型组织，避免重名冲突，并在相应的测试设置文件中全局配置。

## 🎯 统一模拟概述

### 已实现的统一模拟

#### Renderer Process Mocks
- ✅ **PreferenceService** - 渲染进程偏好设置服务模拟
- ✅ **DataApiService** - 渲染进程数据API服务模拟
- ✅ **CacheService** - 渲染进程三层缓存服务模拟
- ✅ **useDataApi hooks** - 数据API钩子模拟 (useQuery, useMutation, usePaginatedQuery, etc.)
- ✅ **usePreference hooks** - 偏好设置钩子模拟 (usePreference, useMultiplePreferences)
- ✅ **useCache hooks** - 缓存钩子模拟 (useCache, useSharedCache, usePersistCache)

#### Main Process Mocks
- ✅ **PreferenceService** - 主进程偏好设置服务模拟
- ✅ **DataApiService** - 主进程数据API服务模拟
- ✅ **CacheService** - 主进程缓存服务模拟

### 🌟 核心优势

- **进程分离**: 按照renderer/main分开组织，避免重名冲突
- **自动应用**: 无需在每个测试文件中单独模拟
- **完整API覆盖**: 实现了所有服务和钩子的完整API
- **类型安全**: 完全支持 TypeScript，保持与真实服务的类型兼容性
- **现实行为**: 模拟提供现实的默认值和行为模式
- **高度可定制**: 支持为特定测试定制行为
- **测试工具**: 内置丰富的测试工具函数

### 📁 文件结构

```
tests/__mocks__/
├── README.md                    # 本文档
├── renderer/                    # 渲染进程模拟
│   ├── PreferenceService.ts     # 渲染进程偏好设置服务模拟
│   ├── DataApiService.ts        # 渲染进程数据API服务模拟
│   ├── CacheService.ts          # 渲染进程缓存服务模拟
│   ├── useDataApi.ts            # 数据API钩子模拟
│   ├── usePreference.ts         # 偏好设置钩子模拟
│   └── useCache.ts              # 缓存钩子模拟
├── main/                        # 主进程模拟
│   ├── PreferenceService.ts     # 主进程偏好设置服务模拟
│   ├── DataApiService.ts        # 主进程数据API服务模拟
│   └── CacheService.ts          # 主进程缓存服务模拟
├── RendererLoggerService.ts     # 渲染进程日志服务模拟
└── MainLoggerService.ts         # 主进程日志服务模拟
```

### 🔧 测试设置

#### Renderer Process Tests
在 `tests/renderer.setup.ts` 中配置了所有渲染进程模拟：

```typescript
// 自动加载 renderer/ 目录下的模拟
vi.mock('@data/PreferenceService', async () => {
  const { MockPreferenceService } = await import('./__mocks__/renderer/PreferenceService')
  return MockPreferenceService
})
// ... 其他渲染进程模拟
```

#### Main Process Tests
在 `tests/main.setup.ts` 中配置了所有主进程模拟：

```typescript
// 自动加载 main/ 目录下的模拟
vi.mock('@main/data/PreferenceService', async () => {
  const { MockMainPreferenceServiceExport } = await import('./__mocks__/main/PreferenceService')
  return MockMainPreferenceServiceExport
})
// ... 其他主进程模拟
```

## PreferenceService Mock

### 简介

`PreferenceService.ts` 提供了 PreferenceService 的统一模拟实现，用于所有渲染进程测试。这个模拟：

- ✅ **自动应用**：在 `renderer.setup.ts` 中全局配置，无需在每个测试文件中单独模拟
- ✅ **完整API**：实现了 PreferenceService 的所有方法（get, getMultiple, set, etc.）
- ✅ **合理默认值**：提供了常用偏好设置的默认值
- ✅ **可定制**：支持为特定测试定制默认值
- ✅ **类型安全**：完全支持 TypeScript 类型检查

### 默认值

模拟提供了以下默认偏好设置：

```typescript
// 导出偏好设置
'data.export.markdown.force_dollar_math': false
'data.export.markdown.exclude_citations': false
'data.export.markdown.standardize_citations': true
'data.export.markdown.show_model_name': false
'data.export.markdown.show_model_provider': false

// UI偏好设置
'ui.language': 'en'
'ui.theme': 'light'
'ui.font_size': 14

// AI偏好设置
'ai.default_model': 'gpt-4'
'ai.temperature': 0.7
'ai.max_tokens': 2000

// 功能开关
'feature.web_search': true
'feature.reasoning': false
'feature.tool_calling': true
```

### 基本使用

由于模拟已经全局配置，大多数测试可以直接使用 PreferenceService，无需额外设置：

```typescript
import { preferenceService } from '@data/PreferenceService'

describe('MyComponent', () => {
  it('should use preference values', async () => {
    // PreferenceService 已经被自动模拟
    const value = await preferenceService.get('ui.theme')
    expect(value).toBe('light') // 使用默认值
  })
})
```

### 高级使用

#### 1. 修改单个测试的偏好值

```typescript
import { preferenceService } from '@data/PreferenceService'
import { vi } from 'vitest'

describe('Custom preferences', () => {
  it('should work with custom preference values', async () => {
    // 为这个测试修改特定值
    ;(preferenceService.get as any).mockImplementation((key: string) => {
      if (key === 'ui.theme') return Promise.resolve('dark')
      // 其他键使用默认模拟行为
      return vi.fn().mockResolvedValue(null)()
    })

    const theme = await preferenceService.get('ui.theme')
    expect(theme).toBe('dark')
  })
})
```

#### 2. 重置模拟状态

```typescript
import { preferenceService } from '@data/PreferenceService'

describe('Mock state management', () => {
  beforeEach(() => {
    // 重置模拟到初始状态
    if ('_resetMockState' in preferenceService) {
      ;(preferenceService as any)._resetMockState()
    }
  })
})
```

#### 3. 检查模拟内部状态

```typescript
import { preferenceService } from '@data/PreferenceService'

describe('Mock inspection', () => {
  it('should allow inspecting mock state', () => {
    // 查看当前模拟状态
    if ('_getMockState' in preferenceService) {
      const state = (preferenceService as any)._getMockState()
      console.log('Current mock state:', state)
    }
  })
})
```

#### 4. 为整个测试套件定制默认值

如果需要为特定的测试文件定制默认值，可以在该文件中重新模拟：

```typescript
import { vi } from 'vitest'

// 重写全局模拟，添加自定义默认值
vi.mock('@data/PreferenceService', async () => {
  const { createMockPreferenceService } = await import('tests/__mocks__/PreferenceService')

  // 定制默认值
  const customDefaults = {
    'my.custom.setting': 'custom_value',
    'ui.theme': 'dark' // 覆盖默认值
  }

  return {
    preferenceService: createMockPreferenceService(customDefaults)
  }
})
```

### 测试验证

可以验证 PreferenceService 方法是否被正确调用：

```typescript
import { preferenceService } from '@data/PreferenceService'
import { vi } from 'vitest'

describe('Preference service calls', () => {
  it('should call preference service methods', async () => {
    await preferenceService.get('ui.theme')

    // 验证方法调用
    expect(preferenceService.get).toHaveBeenCalledWith('ui.theme')
    expect(preferenceService.get).toHaveBeenCalledTimes(1)
  })
})
```

### 添加新的默认值

当项目中添加新的偏好设置时，请在 `PreferenceService.ts` 的 `mockPreferenceDefaults` 中添加相应的默认值：

```typescript
export const mockPreferenceDefaults: Record<string, any> = {
  // 现有默认值...

  // 新增默认值
  'new.feature.enabled': true,
  'new.feature.config': { option: 'value' }
}
```

这样可以确保所有测试都能使用合理的默认值，减少测试失败的可能性。

## DataApiService Mock

### 简介

`DataApiService.ts` 提供了数据API服务的统一模拟，支持所有HTTP方法和高级功能。

### 功能特性

- **完整HTTP支持**: GET, POST, PUT, PATCH, DELETE
- **批量操作**: batch() 和 transaction() 支持
- **订阅系统**: subscribe/unsubscribe 模拟
- **连接管理**: connect/disconnect/ping 方法
- **智能模拟数据**: 基于路径自动生成合理的响应

### 基本使用

```typescript
import { dataApiService } from '@data/DataApiService'

describe('API Integration', () => {
  it('should fetch topics', async () => {
    // 自动模拟，返回预设的主题列表
    const response = await dataApiService.get('/api/topics')
    expect(response.success).toBe(true)
    expect(response.data.topics).toHaveLength(2)
  })
})
```

### 高级使用

```typescript
import { MockDataApiUtils } from 'tests/__mocks__/DataApiService'

describe('Custom API behavior', () => {
  beforeEach(() => {
    MockDataApiUtils.resetMocks()
  })

  it('should handle custom responses', async () => {
    // 设置特定路径的自定义响应
    MockDataApiUtils.setCustomResponse('/api/topics', 'GET', {
      topics: [{ id: 'custom', name: 'Custom Topic' }]
    })

    const response = await dataApiService.get('/api/topics')
    expect(response.data.topics[0].name).toBe('Custom Topic')
  })

  it('should simulate errors', async () => {
    // 模拟错误响应
    MockDataApiUtils.setErrorResponse('/api/topics', 'GET', 'Network error')

    const response = await dataApiService.get('/api/topics')
    expect(response.success).toBe(false)
    expect(response.error?.message).toBe('Network error')
  })
})
```

## CacheService Mock

### 简介

`CacheService.ts` 提供了三层缓存系统的完整模拟：内存缓存、共享缓存和持久化缓存。

### 功能特性

- **三层架构**: 内存、共享、持久化缓存
- **订阅系统**: 支持缓存变更订阅
- **TTL支持**: 模拟缓存过期（简化版）
- **Hook引用跟踪**: 模拟生产环境的引用管理
- **默认值**: 基于缓存schema的智能默认值

### 基本使用

```typescript
import { cacheService } from '@data/CacheService'

describe('Cache Operations', () => {
  it('should store and retrieve cache values', () => {
    // 设置缓存值
    cacheService.set('user.preferences', { theme: 'dark' })

    // 获取缓存值
    const preferences = cacheService.get('user.preferences')
    expect(preferences.theme).toBe('dark')
  })

  it('should work with persist cache', () => {
    // 持久化缓存操作
    cacheService.setPersist('app.last_opened_topic', 'topic123')
    const lastTopic = cacheService.getPersist('app.last_opened_topic')
    expect(lastTopic).toBe('topic123')
  })
})
```

### 高级测试工具

```typescript
import { MockCacheUtils } from 'tests/__mocks__/CacheService'

describe('Advanced cache testing', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
  })

  it('should set initial cache state', () => {
    // 设置初始缓存状态
    MockCacheUtils.setInitialState({
      memory: [['theme', 'dark'], ['language', 'en']],
      persist: [['app.version', '1.0.0']]
    })

    expect(cacheService.get('theme')).toBe('dark')
    expect(cacheService.getPersist('app.version')).toBe('1.0.0')
  })

  it('should simulate cache changes', () => {
    let changeCount = 0
    cacheService.subscribe('theme', () => changeCount++)

    MockCacheUtils.triggerCacheChange('theme', 'light')
    expect(changeCount).toBe(1)
  })
})
```

## useDataApi Hooks Mock

### 简介

`useDataApi.ts` 提供了所有数据API钩子的统一模拟，包括查询、变更和分页功能。

### 支持的钩子

- `useQuery` - 数据查询钩子
- `useMutation` - 数据变更钩子
- `usePaginatedQuery` - 分页查询钩子
- `useInvalidateCache` - 缓存失效钩子
- `prefetch` - 预取函数

### 基本使用

```typescript
import { useQuery, useMutation } from '@data/hooks/useDataApi'

describe('Data API Hooks', () => {
  it('should work with useQuery', () => {
    const { data, isLoading, error } = useQuery('/api/topics')

    // 默认返回模拟数据
    expect(data).toBeDefined()
    expect(data.topics).toHaveLength(2)
    expect(isLoading).toBe(false)
    expect(error).toBeUndefined()
  })

  it('should work with useMutation', async () => {
    const { trigger, isMutating } = useMutation('/api/topics', 'POST')

    const result = await trigger({ name: 'New Topic' })
    expect(result.created).toBe(true)
    expect(result.name).toBe('New Topic')
  })
})
```

### 自定义测试行为

```typescript
import { MockUseDataApiUtils } from 'tests/__mocks__/useDataApi'

describe('Custom hook behavior', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
  })

  it('should mock loading state', () => {
    MockUseDataApiUtils.mockQueryLoading('/api/topics')

    const { data, isLoading } = useQuery('/api/topics')
    expect(isLoading).toBe(true)
    expect(data).toBeUndefined()
  })

  it('should mock error state', () => {
    const error = new Error('API Error')
    MockUseDataApiUtils.mockQueryError('/api/topics', error)

    const { data, error: queryError } = useQuery('/api/topics')
    expect(queryError).toBe(error)
    expect(data).toBeUndefined()
  })
})
```

## usePreference Hooks Mock

### 简介

`usePreference.ts` 提供了偏好设置钩子的统一模拟，支持单个和批量偏好管理。

### 支持的钩子

- `usePreference` - 单个偏好设置钩子
- `useMultiplePreferences` - 多个偏好设置钩子

### 基本使用

```typescript
import { usePreference, useMultiplePreferences } from '@data/hooks/usePreference'

describe('Preference Hooks', () => {
  it('should work with usePreference', async () => {
    const [theme, setTheme] = usePreference('ui.theme')

    expect(theme).toBe('light') // 默认值

    await setTheme('dark')
    // 在测试中，可以通过工具函数验证值是否更新
  })

  it('should work with multiple preferences', async () => {
    const [prefs, setPrefs] = useMultiplePreferences({
      theme: 'ui.theme',
      lang: 'ui.language'
    })

    expect(prefs.theme).toBe('light')
    expect(prefs.lang).toBe('en')

    await setPrefs({ theme: 'dark' })
  })
})
```

### 高级测试

```typescript
import { MockUsePreferenceUtils } from 'tests/__mocks__/usePreference'

describe('Advanced preference testing', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  it('should simulate preference changes', () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.theme', 'dark')

    const [theme] = usePreference('ui.theme')
    expect(theme).toBe('dark')
  })

  it('should simulate external changes', () => {
    let callCount = 0
    MockUsePreferenceUtils.addSubscriber('ui.theme', () => callCount++)

    MockUsePreferenceUtils.simulateExternalPreferenceChange('ui.theme', 'dark')
    expect(callCount).toBe(1)
  })
})
```

## useCache Hooks Mock

### 简介

`useCache.ts` 提供了缓存钩子的统一模拟，支持三种缓存层级。

### 支持的钩子

- `useCache` - 内存缓存钩子
- `useSharedCache` - 共享缓存钩子
- `usePersistCache` - 持久化缓存钩子

### 基本使用

```typescript
import { useCache, useSharedCache, usePersistCache } from '@data/hooks/useCache'

describe('Cache Hooks', () => {
  it('should work with useCache', () => {
    const [theme, setTheme] = useCache('ui.theme', 'light')

    expect(theme).toBe('light')
    setTheme('dark')
    // 值立即更新
  })

  it('should work with different cache types', () => {
    const [shared, setShared] = useSharedCache('app.window_count', 1)
    const [persist, setPersist] = usePersistCache('app.last_version', '1.0.0')

    expect(shared).toBe(1)
    expect(persist).toBe('1.0.0')
  })
})
```

### 测试工具

```typescript
import { MockUseCacheUtils } from 'tests/__mocks__/useCache'

describe('Cache hook testing', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
  })

  it('should set initial cache state', () => {
    MockUseCacheUtils.setMultipleCacheValues({
      memory: [['ui.theme', 'dark']],
      shared: [['app.mode', 'development']],
      persist: [['user.id', 'user123']]
    })

    const [theme] = useCache('ui.theme')
    const [mode] = useSharedCache('app.mode')
    const [userId] = usePersistCache('user.id')

    expect(theme).toBe('dark')
    expect(mode).toBe('development')
    expect(userId).toBe('user123')
  })
})
```

## LoggerService Mock

### 简介

项目还包含了 LoggerService 的模拟：
- `RendererLoggerService.ts` - 渲染进程日志服务模拟
- `MainLoggerService.ts` - 主进程日志服务模拟

这些模拟同样在相应的测试设置文件中全局配置。

## 最佳实践

1. **优先使用全局模拟**：大多数情况下应该直接使用全局配置的模拟，而不是在每个测试中单独模拟
2. **合理的默认值**：确保模拟的默认值反映实际应用的常见配置
3. **文档更新**：当添加新的模拟或修改现有模拟时，请更新相关文档
4. **类型安全**：保持模拟与实际服务的类型兼容性
5. **测试隔离**：如果需要修改模拟行为，确保在测试后恢复或在 beforeEach 中重置

## 故障排除

### 模拟未生效

如果发现 PreferenceService 模拟未生效：

1. 确认测试运行在渲染进程环境中（`vitest.config.ts` 中的 `renderer` 项目）
2. 检查 `tests/renderer.setup.ts` 是否正确配置
3. 确认导入路径使用的是 `@data/PreferenceService` 而非相对路径

### 类型错误

如果遇到 TypeScript 类型错误：

1. 确认模拟实现与实际 PreferenceService 接口匹配
2. 在测试中使用类型断言：`(preferenceService as any)._getMockState()`
3. 检查是否需要更新模拟的类型定义