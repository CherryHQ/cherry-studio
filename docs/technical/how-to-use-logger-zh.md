# 如何使用日志 LoggerService

这是关于如何使用日志的开发者文档。

CherryStudio使用统一的日志服务来打印和记录日志，**若无特殊原因，请勿使用`console.xxx`来打印日志**。

以下是详细说明。

## 在`main`进程中使用

### 引入

```typescript
import { loggerService } from '@logger'
```

### 设置module信息（规范要求）

在import头之后，设置：

```typescript
const logger = loggerService.withContext('moduleName')
```

- `moduleName`是当前文件模块的名称，命名可以以文件名、主类名、主函数名等，原则是清晰明了
- `moduleName`会在终端中打印出来，也会在文件日志中体现，方便筛选

### 设置`CONTEXT`信息（可选）

在`withContext`中，也可以设置其他`CONTEXT`信息：

```typescript
const logger = loggerService.withContext('moduleName', CONTEXT)
```

- `CONTEXT`为`{ key: value, ... }`
- `CONTEXT`信息不会在终端中打印出来，但是会在文件日志中记录，方便筛选

### 记录日志

在代码中，可以随时调用 `logger` 来记录日志，支持的级别有：`error`, `warn`, `info`, `verbose`, `debug`, `silly`。

各级别的含义，请参考后面的章节。

以下支持的记录日志的参数（以 `logger.LEVEL` 举例如何使用，`LEVEL`指代为上述级别）：

```typescript
logger.LEVEL(message)
logger.LEVEL(message, CONTEXT)
logger.LEVEL(message, error)
logger.LEVEL(message, error, CONTEXT)
```

**只支持上述四种调用方式**。

| 参数      | 类型     | 说明                                                                                                                                                                                              |
| --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message` | `string` | 必填项。这是日志的核心字段，记录的重点内容                                                                                                                                                        |
| `CONTEXT` | `object` | 可选。其他需要再日志文件中记录的信息，建议为`{ key: value, ...}`格式                                                                                                                              |
| `error`   | `Error`  | 可选。同时会打印错误堆栈信息。<br />注意`catch(error)`所捕获的`error`是`unknown`类型，按照`Typescript`最佳实践，请先用`instanceof`进行类型判断，如果确信一定是`Error`类型，也可用断言`as Error`。 |

#### 记录非`object`类型的上下文信息

```typescript
const foo = getFoo()
logger.debug(`foo ${foo}`)
```

### 记录级别

- 开发环境下，所有级别的日志都会打印到终端，并且记录到文件日志中
- 生产环境下，默认记录级别为`info`，日志只会记录到文件，不会打印到终端

更改日志记录级别：

- 可以通过 `logger.setLevel('newLevel')` 来更改日志记录级别
- `logger.resetLevel()` 可以重置为默认级别
- `logger.getLevel()` 可以获取当前记录记录级别

**注意** 更改日志记录级别是全局生效的，请不要在代码中随意更改，除非你非常清楚自己在做什么

## 在`renderer`进程中使用

在`renderer`进程中使用，_引入方法_、_设置`module`信息_、*设置`context`信息的方法*和`main`进程中是**完全一样**的。

下面着重讲一下不同之处。

### `initWindowSource`

`renderer`进程中，有不同的`window`，在开始使用`logger`之前，我们必须设置`window`信息：

```typescript
loggerService.initWindowSource('windowName')
```

原则上，我们将在`window`的`entryPoint.tsx`中进行设置，这可以保证`windowName`在开始使用前已经设置好了。

- 未设置`windowName`会报错，`logger`将不起作用
- `windowName`只能设置一次，重复设置将不生效
- `windowName`不会在`devTool`的`console`中打印出来，但是会在`main`进程的终端和文件日志中记录
- `initWindowSource`返回的是LoggerService的实例，因此可以做链式调用

### 记录级别

- 开发环境下，默认所有级别的日志都会打印到`devTool`的`console`
- 生产环境下，默认记录级别为`info`，日志会打印到`devTool`的`console`
- 在开发和生产环境下，默认`warn`和`error`级别的日志，会传输给`main`进程，并记录到文件日志
  - 开发环境下，`main`进程终端中也会打印传输过来的日志

#### 更改日志记录级别

和`main`进程中一样，你可以通过`setLevel('level')`、`resetLevel()`和`getLevel()`来管理日志记录级别。

同样，该日志记录级别也是全局调整的。

#### 更改传输到`main`的级别

将`renderer`的日志发送到`main`，并由`main`统一管理和记录到文件（根据`main`的记录到文件的级别），默认只有`warn`和`error`级别的日志会传输到`main`

有以下两种方式，可以更改传输到`main`的日志级别：

##### 全局更改

以下方法可以分别设置、重置和获取传输到`main`的日志级别

```typescript
logger.setLogToMainLevel('newLevel')
logger.resetLogToMainLevel()
logger.getLogToMainLevel()
```

**注意** 该方法是全局生效的，请不要在代码中随意更改，除非你非常清楚自己在做什么

##### 单条更改

在日志记录的最末尾，加上`{ logToMain: true }`，即可将本条日志传输到`main`（不受全局日志级别限制），例如：

```typescript
logger.info('message', { logToMain: true })
```

## 关于`worker`线程

- 现在不支持`main`进程中的`worker`的日志。
- 支持`renderer`中起的`worker`的日志，但是现在该日志不会发送给`main`进行记录。

### 如何在`renderer`的`worker`中使用日志

由于`worker`线程是独立的，在其中使用LoggerService，等同于在一个新`renderer`窗口中使用。因此也必须先`initWindowSource`。

如果`worker`比较简单，只有一个文件，也可以使用链式语法直接使用：

```typescript
const logger = loggerService.initWindowSource('Worker').withContext('LetsWork')
```

## 使用环境变量来筛选要显示的日志

在开发环境中，可以通过环境变量的定义，来筛选要显示的日志的级别和module。开发者可以专注于自己的日志，提高开发效率。

环境变量可以在终端中自行设置，或者在开发根目录的`.env`文件中进行定义，可以定义的变量如下：

| 变量名                           | 含义                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `CSLOGGER_MAIN_LEVEL`            | 用于`main`进程的日志级别，低于该级别的日志将不显示                                              |
| `CSLOGGER_MAIN_SHOW_MODULES`     | 用于`main`进程的日志module筛选，用`,`分隔，区分大小写。只有在该列表中的module的日志才会显示     |
| `CSLOGGER_RENDERER_LEVEL`        | 用于`renderer`进程的日志级别，低于该级别的日志将不显示                                          |
| `CSLOGGER_RENDERER_SHOW_MODULES` | 用于`renderer`进程的日志module筛选，用`,`分隔，区分大小写。只有在该列表中的module的日志才会显示 |

示例：

```bash
CSLOGGER_MAIN_LEVEL=verbose
CSLOGGER_MAIN_SHOW_MODULES=MCPService,SelectionService
```

注意：

- 环境变量仅在开发环境中生效
- 该变量仅会改变在终端或在devTools中显示的日志，不会影响文件日志和`logToMain`的记录逻辑

## 日志级别的使用规范

日志有很多级别，什么时候应该用哪个级别，下面是在CherryStudio中应该遵循的规范：
(按日志级别从高到低排列)

| 日志级别      | 核心定义与使用场景                                                                                       | 示例                                                                                                                                                 |
| :------------ | :------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`error`**   | **严重错误，导致程序崩溃或核心功能无法使用。** <br> 这是最高优的日志，通常需要立即上报或提示用户。       | - 主进程或渲染进程崩溃。 <br> - 无法读写用户关键数据文件（如数据库、配置文件），导致应用无法运行。<br> - 所有未捕获的异常。                          |
| **`warn`**    | **潜在问题或非预期情况，但不影响程序核心功能。** <br> 程序可以从中恢复或使用备用方案。                   | - 配置文件 `settings.json` 缺失，已使用默认配置启动。 <br> - 自动更新检查失败，但不影响当前版本使用。<br> - 某个非核心插件加载失败。                 |
| **`info`**    | **记录应用生命周期和关键用户行为。** <br> 这是发布版中默认应记录的级别，用于追踪用户的主要操作路径。     | - 应用启动、退出。<br> - 用户成功打开/保存文件。 <br> - 主窗口创建/关闭。<br> - 开始执行一项重要任务（如“开始导出视频”）。                           |
| **`verbose`** | **比 `info` 更详细的流程信息，用于追踪特定功能。** <br> 在诊断特定功能问题时开启，帮助理解内部执行流程。 | - 正在加载 `Toolbar` 模块。 <br> - IPC 消息 `open-file-dialog` 已从渲染进程发送。<br> - 正在应用滤镜 'Sepia' 到图像。                                |
| **`debug`**   | **开发和调试时使用的详细诊断信息。** <br> **严禁在发布版中默认开启**，因为它可能包含敏感数据并影响性能。 | - 函数 `renderImage` 的入参: `{ width: 800, ... }`。<br> - IPC 消息 `save-file` 收到的具体数据内容。<br> - 渲染进程中 Redux/Vuex 的 state 变更详情。 |
| **`silly`**   | **最详尽的底层信息，仅用于极限调试。** <br> 几乎不在常规开发中使用，仅为解决棘手问题。                   | - 鼠标移动的实时坐标 `(x: 150, y: 320)`。<br> - 读取文件时每个数据块（chunk）的大小。<br> - 每一次渲染帧的耗时。                                     |
