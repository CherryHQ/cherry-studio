# 数据重构项目测试窗口

专用于测试数据重构项目各项功能的独立测试窗口系统，包括 PreferenceService、CacheService、DataApiService 和相关 React hooks。

## 🎯 当前实现

✅ **已完成的功能**：

- 专用的测试窗口 (DataRefactorTestWindow)
- **双窗口启动**：应用启动时会同时打开主窗口和两个测试窗口
- **跨窗口同步测试**：两个测试窗口可以相互验证偏好设置的实时同步
- **实时UI联动**：主题、语言、缩放等偏好设置变化会立即反映在UI上
- **🎛️ Slider联动测试**：多个交互式滑块控制数值类型偏好设置，支持跨窗口实时同步
- **多源窗口编号**：支持URL参数、窗口标题、窗口名称等多种方式确定窗口编号
- 完整的测试界面，包含4个专业测试组件
- 自动窗口定位，避免重叠
- 窗口编号标识，便于区分

## 测试组件

## PreferenceService 测试模块

### 1. PreferenceService 基础测试

- 直接测试服务层API：get, set, getCachedValue, isCached, preload, getMultiple
- 支持各种数据类型：字符串、数字、布尔值、JSON对象
- 实时显示操作结果

### 2. usePreference Hook 测试

- 测试单个偏好设置的React hooks
- 支持的测试键：
  - `app.theme.mode` - 主题模式
  - `app.language` - 语言设置
  - `app.spell_check.enabled` - 拼写检查
  - `app.zoom_factor` - 缩放因子 (🎛️ 支持Slider)
  - `chat.message.font_size` - 消息字体大小 (🎛️ 支持Slider)
  - `feature.selection.action_window_opacity` - 选择窗口透明度 (🎛️ 支持Slider)
- 实时值更新和类型转换
- **Slider联动控制**：数值类型偏好设置提供交互式滑块，支持实时拖拽调整

### 3. usePreferences 批量操作测试

- 测试多个偏好设置的批量管理
- 5种预设场景：基础设置、UI设置、用户设置、🎛️数值设置、自定义组合
- **🎛️ 数值设置场景**：专门的Slider联动控制区域，包含缩放、字体、选择窗口透明度三个滑块
- 批量更新功能，支持JSON格式输入
- 快速切换操作

### 4. Hook 高级功能测试

- 预加载机制测试
- 订阅机制验证
- 缓存管理测试
- 性能测试
- 多个hook实例同步测试

## CacheService 测试模块

### 1. CacheService 直接API测试

- **三层缓存架构测试**：Memory cache、Shared cache、Persist cache
- **基础操作**: get, set, has, delete 方法的完整测试
- **TTL支持**: 可配置的过期时间测试（2s、5s、10s）
- **跨窗口同步**: Shared cache 和 Persist cache 的实时同步验证
- **数据类型支持**: 字符串、数字、对象、数组等多种数据类型
- **性能优化**: 显示操作计数和自动刷新机制

### 2. Cache Hooks 基础测试

- **useCache Hook**: 测试内存缓存的React集成
  - 默认值自动设置
  - 实时值更新和类型安全
  - Hook生命周期管理
- **useSharedCache Hook**: 测试跨窗口缓存同步
  - 跨窗口实时同步验证
  - 广播机制测试
  - 并发更新处理
- **usePersistCache Hook**: 测试持久化缓存
  - 类型安全的预定义Schema
  - localStorage持久化
  - 默认值回退机制
- **数据类型测试**:
  - 数字类型滑块控制
  - 复杂对象结构更新
  - 实时渲染统计

### 3. Cache 高级功能测试

- **TTL过期机制**:
  - 实时倒计时进度条
  - 自动过期验证
  - 懒加载清理机制
- **Hook引用保护**:
  - 活跃Hook的key删除保护
  - 引用计数验证
  - 错误处理测试
- **深度相等性优化**:
  - 相同引用跳过测试
  - 相同内容深度比较
  - 性能优化验证
- **性能测试**:
  - 快速更新测试（100次/秒）
  - 订阅触发统计
  - 渲染次数监控
- **多Hook同步**:
  - 同一key的多个hook实例
  - 跨缓存类型同步测试

### 4. Cache 压力测试

- **快速操作测试**:
  - 1000次操作/10秒高频测试
  - 每秒操作数统计
  - 错误率监控
- **并发更新测试**:
  - 多个Hook同时更新
  - 跨窗口并发处理
  - 数据一致性验证
- **大数据测试**:
  - 10KB、100KB、1MB对象存储
  - 内存使用估算
  - 存储限制警告
- **存储限制测试**:
  - localStorage容量测试
  - 缓存大小监控
  - 性能影响评估

## 启动方式

**自动启动**：应用正常启动时会自动创建两个测试窗口，窗口会自动错位显示避免重叠

**手动启动**：

```javascript
// 在开发者控制台中执行 - 创建单个测试窗口
const { dataRefactorMigrateService } = require('./out/main/data/migrate/dataRefactor/DataRefactorMigrateService')
dataRefactorMigrateService.createTestWindow()

// 创建多个测试窗口
dataRefactorMigrateService.createTestWindow() // 第二个窗口
dataRefactorMigrateService.createTestWindow() // 第三个窗口...

// 关闭所有测试窗口
dataRefactorMigrateService.closeTestWindows()
```

## 文件结构

```
src/renderer/src/windows/dataRefactorTest/
├── entryPoint.tsx                    # 窗口入口
├── TestApp.tsx                       # 主应用组件
└── components/
    # PreferenceService 测试组件
    ├── PreferenceServiceTests.tsx    # 服务层测试
    ├── PreferenceBasicTests.tsx      # 基础Hook测试
    ├── PreferenceHookTests.tsx       # 高级Hook测试
    ├── PreferenceMultipleTests.tsx   # 批量操作测试

    # CacheService 测试组件
    ├── CacheServiceTests.tsx         # 直接API测试
    ├── CacheBasicTests.tsx          # Hook基础测试
    ├── CacheAdvancedTests.tsx       # 高级功能测试
    ├── CacheStressTests.tsx         # 压力测试

    # DataApiService 测试组件
    ├── DataApiBasicTests.tsx         # 基础CRUD测试
    ├── DataApiAdvancedTests.tsx      # 高级功能测试
    ├── DataApiHookTests.tsx          # React Hooks测试
    └── DataApiStressTests.tsx        # 压力测试
```

## 跨窗口同步测试

🔄 **测试场景**：

### PreferenceService 跨窗口同步
1. **实时同步验证**：在窗口#1中修改某个偏好设置，立即观察窗口#2是否同步更新
2. **并发修改测试**：在两个窗口中快速连续修改同一设置，验证数据一致性
3. **批量操作同步**：在一个窗口中批量更新多个设置，观察另一个窗口的同步表现
4. **Hook实例同步**：验证多个usePreference hook实例是否正确同步

### CacheService 跨窗口同步
1. **Shared Cache同步**：在窗口#1中设置共享缓存，观察窗口#2的实时更新
2. **Persist Cache同步**：修改持久化缓存，验证所有窗口的localStorage同步
3. **TTL跨窗口验证**：在一个窗口设置TTL，观察其他窗口的过期行为
4. **并发缓存操作**：多窗口同时操作同一缓存key，验证数据一致性
5. **Hook引用保护**：在一个窗口尝试删除其他窗口正在使用的缓存key

📋 **测试步骤**：

### PreferenceService 测试步骤
1. 同时打开两个测试窗口（自动启动）
2. 选择相同的偏好设置键进行测试
3. 在窗口#1中修改值，观察窗口#2的反应
4. 检查"Hook 高级功能测试"中的订阅触发次数是否增加
5. 验证缓存状态和实时数据的一致性

### CacheService 测试步骤
1. 同时打开两个测试窗口（自动启动）
2. **Memory Cache测试**：仅在当前窗口有效，其他窗口不受影响
3. **Shared Cache测试**：在窗口#1设置共享缓存，立即检查窗口#2是否同步
4. **Persist Cache测试**：修改持久化缓存，验证localStorage和跨窗口同步
5. **TTL测试**：设置带过期时间的缓存，观察倒计时和跨窗口过期行为
6. **压力测试**：运行高频操作，监控性能指标和错误率
7. **引用保护测试**：在Hook活跃时尝试删除key，验证保护机制

## 注意事项

⚠️ **重要警告**：

### PreferenceService 警告
- **真实数据库存储**：测试使用真实的偏好设置系统
- **跨应用同步**：修改的值会同步到主应用和所有测试窗口
- **持久化影响**：所有更改都会持久化到SQLite数据库

### CacheService 警告
- **内存占用**：压力测试可能消耗大量内存，影响浏览器性能
- **localStorage影响**：大数据测试会占用浏览器存储空间（最大5-10MB）
- **性能影响**：高频操作测试可能短暂影响UI响应性
- **跨窗口影响**：Shared和Persist缓存会影响所有打开的窗口
- **TTL清理**：过期缓存会自动清理，可能影响其他功能的测试数据

## 开发模式特性

- 自动打开DevTools便于调试
- 支持热重载
- 完整的TypeScript类型检查
- React DevTools支持

## 💡 快速开始

### PreferenceService 快速测试
1. **启动应用** - 自动打开2个测试窗口
2. **选择测试** - 在"usePreference Hook 测试"中选择要测试的偏好设置键
3. **🎛️ Slider联动测试** - 选择数值类型偏好设置，拖动Slider观察实时变化
4. **跨窗口验证** - 在窗口#1中修改值，观察窗口#2是否同步
5. **批量Slider测试** - 切换到"数值设置场景"，同时拖动多个滑块测试批量同步
6. **高级测试** - 使用"Hook 高级功能测试"验证订阅和缓存机制

### CacheService 快速测试
1. **基础操作** - 使用"CacheService 直接API测试"进行get/set/delete操作
2. **Hook测试** - 在"Cache Hooks 基础测试"中测试不同数据类型和默认值
3. **TTL验证** - 设置2秒TTL缓存，观察实时倒计时和自动过期
4. **跨窗口同步** - 设置Shared Cache，在另一窗口验证实时同步
5. **持久化测试** - 修改Persist Cache，刷新页面验证localStorage持久化
6. **压力测试** - 运行"快速操作测试"，观察高频操作的性能表现
7. **引用保护** - 启用Hook后尝试删除key，验证保护机制

## 🔧 技术实现

### 基础架构
- **窗口管理**: DataRefactorMigrateService 单例管理多个测试窗口
- **跨窗口识别**: 多源窗口编号支持，确保每个窗口都有唯一标识
- **UI框架**: Ant Design + styled-components + React 18
- **类型安全**: 完整的 TypeScript 类型检查和类型约束

### PreferenceService 技术实现
- **数据同步**: 基于真实的 PreferenceService 和 IPC 通信
- **实时主题**: 使用 useSyncExternalStore 实现主题、缩放等设置的实时UI响应
- **类型约束**: 偏好设置键的完整TypeScript类型检查

### CacheService 技术实现
- **三层缓存**: Memory (Map) + Shared (Map + IPC) + Persist (Map + localStorage)
- **React集成**: useSyncExternalStore 实现外部状态订阅
- **性能优化**: Object.is() 浅比较 + 深度相等性检查，跳过无效更新
- **TTL管理**: 懒加载过期检查，基于时间戳的精确控制
- **IPC同步**: 跨进程消息广播，支持批量操作和增量更新
- **引用跟踪**: Set-based Hook引用计数，防止意外删除
- **错误处理**: 完善的try-catch机制和用户友好的错误提示
- **内存管理**: 自动清理、定时器管理和资源释放
