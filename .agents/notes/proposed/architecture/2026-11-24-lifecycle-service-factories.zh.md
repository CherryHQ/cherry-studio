# Agent Note: 参数化生命周期服务的类型化工厂

Status: proposed

[English](2026-11-24-lifecycle-service-factories.md) | 中文

## 问题

生命周期注册表将所有构造器擦除为 `new (...args: unknown[]) => T`。这个签名要求类接受任意参数，而 `AiStreamManager` 和 `UtilityProcessManager` 接受特定参数，因此有效的类也无法满足该签名。对构造器使用断言或扩大参数类型，只会掩盖这种不匹配。

容器还会按声明顺序，将解析后的 `@DependsOn` 实例传入构造器。因此，配置参数在前的 `AiStreamManager` 会把 `RuntimeActivityService` 当成配置。这是服务参数错位，不能据此取消容器的构造注入。

本 Spec 负责[anti-slop 迁移](../process/2026-11-18-anti-slop-lint.md)所需的注册机制，不替代该迁移的规则范围或验证要求。

## 提案

保留现有类注册的自动构造注入，为参数化服务增加显式的同步工厂注册。将用于元数据和查找的类身份，与可调用的构造签名分开。

```typescript
interface ServiceClassIdentity<T> {
  readonly name: string
  readonly prototype: T
}

interface ServiceFactoryRegistration<T> {
  readonly kind: 'factory'
  readonly target: ServiceClassIdentity<T>
  readonly create: () => T
}

declare function defineServiceFactory<T>(
  target: ServiceClassIdentity<T>,
  create: () => NoInfer<T>
): ServiceFactoryRegistration<T>
```

返回类型由目标类确定；`NoInfer` 阻止回调为了容纳不兼容的服务或 Promise 而扩大该类型。注册阶段读取目标类已有的名称、阶段、依赖、优先级、错误策略和条件元数据，不执行工厂。构造阶段先解析全部已声明依赖，保留缺失依赖和条件排除行为，再无参调用工厂。类注册继续执行 `new useClass(...deps)`，参数顺序保持不变。两条路径都保留惰性单例构造，以及按类和名称查找的能力。

正常 bootstrap 仍负责初始化顺序。提前直接调用 `get()` 只会同步构造实例，不保证依赖已经完成初始化。工厂必须同步返回实例，不增加激活或初始化阶段。

`services` 继续保持类值映射，并由它推导 `ServiceRegistry`。仅为两个参数化注册声明工厂覆盖项，从 `{ ...services, ...factoryOverrides }` 构造 `serviceList`。替换已有属性会保留声明顺序，调用方仍可获得类身份。

```typescript
defineServiceFactory(AiStreamManager, () => new AiStreamManager())
defineServiceFactory(UtilityProcessManager, () => new UtilityProcessManager())
```

`AiStreamManager` 保留配置参数在前的可选构造器，并继续通过已有的 `application.get('RuntimeActivityService')` 调用持有活动。工厂显式不传参数，已解析的依赖实例不会作为配置传入。直接构造调用点保留原有契约。`UtilityProcessManager` 保留现有的可选依赖覆盖构造器和生产默认值。其他服务的注册和构造器保持不变。参考文档说明两种注册路径及其初始化限制。

## 考虑过的替代方案

- 全部服务改成无参构造：为了解决两个注册，取消已有的注入契约。
- 用 `any`、`never` 或断言扩大构造器类型：无法表达真实参数契约，以及注册类和实例的关系。
- 将 AiStreamManager 改为依赖参数在前：会改变配置参数在前的契约和直接调用点，而显式工厂构造并不需要这种改动。
- 增加依赖类型注册表和类型化装饰器：会扩展所有服务与组合边界的生命周期类型体系；本次修复只需要两个显式构造。

## 验收标准

- AC1 — ServiceContainer 单元测试观察普通类注入的依赖实例身份与声明顺序，惰性单例行为保持不变。 (verification: unit)
- AC2 — 工厂单元测试观察注册期间不执行、创建前先解析依赖、每个容器只创建一次，以及按类和名称查找获得相同实例。 (verification: unit)
- AC3 — ServiceContainer 单元测试确认条件与传递排除会阻止工厂执行，缺失或失败依赖阻止创建，工厂失败沿用既有失败传播。 (verification: unit)
- AC4 — 主进程类型检查拒绝返回不兼容服务或 Promise 的工厂，接受两个参数化生产服务，且不需要构造器擦除断言或扩大参数类型。 (verification: unit)
- AC5 — AiStreamManager 契约测试在保留原有配置参数在前的构造方式时仍保持配置的缓冲区和宽限期行为，并在执行结束后释放活动；UtilityProcessManager 测试保留默认和覆盖依赖行为。 (verification: unit)
- AC6 — 生命周期单元覆盖保留两种注册路径的阶段初始化与关闭行为；文档明确提前直接解析仅构造实例，不代表初始化就绪。 (verification: unit)
- AC7 — 服务注册覆盖确认两个注册被工厂覆盖后，类值注册表与声明顺序保持不变。 (verification: unit)
- AC8 — 参考文档说明工厂注册、直接构造及初始化限制，双语 Spec 通过文档门禁。 (verification: docs gate)

## 风险

类身份不能再次获得承诺任意参数的构造签名。工厂结果推导必须始终由目标类约束。工厂只构造目标，不通过全局 application 解析依赖。AiStreamManager 保留原有的 application 活动服务查找方式；本提案不引入容器内的活动依赖注入。工厂和类路径需要共用注册与条件排除逻辑，避免元数据行为发生分歧。

本方案仍处于提议状态，Spec PR 存在后才开始容器实现。anti-slop 清理及其最后一条规则，仍须清除自身发现项并通过云端检查；发布本 Spec 不代表构建已经通过。
