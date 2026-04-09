# KnowledgeService Concurrency Control

This document details the concurrency control and workload management mechanism in `KnowledgeService`.

## Concurrency Control and Workload Management

KnowledgeService implements a fine-grained task queue system to control the number of concurrently processed items and workload. This system is implemented through the following key components:

### 1. Key Variables and Limits

```typescript
private workload = 0
private processingItemCount = 0
private knowledgeItemProcessingQueueMappingPromise: Map<LoaderTaskOfSet, () => void> = new Map()
private static MAXIMUM_WORKLOAD = 1024 * 1024 * 80  // ~80MB
private static MAXIMUM_PROCESSING_ITEM_COUNT = 30
```

- `workload`: Tracks the total work currently being processed (in bytes)
- `processingItemCount`: Tracks the number of items currently being processed
- `MAXIMUM_WORKLOAD`: Maximum workload set to 80MB
- `MAXIMUM_PROCESSING_ITEM_COUNT`: Maximum concurrent processing items set to 30

### 2. Workload Estimation

Each task has a workload estimation mechanism via the `evaluateTaskWorkload` property:

```typescript
interface EvaluateTaskWorkload {
  workload: number
}
```

Different task types have different workload estimations:

- File tasks: Use file size as workload `{ workload: file.size }`
- URL tasks: Use a fixed value `{ workload: 1024 * 1024 * 2 }` (~2MB)
- Sitemap tasks: Use a fixed value `{ workload: 1024 * 1024 * 20 }` (~20MB)
- Note tasks: Use text content byte length `{ workload: contentBytes.length }`

### 3. Task State Management

Tasks track their lifecycle through a state enum:

```typescript
enum LoaderTaskItemState {
  PENDING,    // Waiting to be processed
  PROCESSING, // Currently being processed
  DONE        // Completed
}
```

### 4. Core Queue Processing Logic

The core queue processing logic resides in the `processingQueueHandle` method:

```typescript
private processingQueueHandle() {
  const getSubtasksUntilMaximumLoad = (): QueueTaskItem[] => {
    const queueTaskList: QueueTaskItem[] = []
    that: for (const [task, resolve] of this.knowledgeItemProcessingQueueMappingPromise) {
      for (const item of task.loaderTasks) {
        if (this.maximumLoad()) {
          break that
        }

        const { state, task: taskPromise, evaluateTaskWorkload } = item

        if (state !== LoaderTaskItemState.PENDING) {
          continue
        }

        const { workload } = evaluateTaskWorkload
        this.workload += workload
        this.processingItemCount += 1
        item.state = LoaderTaskItemState.PROCESSING
        queueTaskList.push({
          taskPromise: () =>
            taskPromise().then(() => {
              this.workload -= workload
              this.processingItemCount -= 1
              task.loaderTasks.delete(item)
              if (task.loaderTasks.size === 0) {
                this.knowledgeItemProcessingQueueMappingPromise.delete(task)
                resolve()
              }
              this.processingQueueHandle()
            }),
          resolve: () => {},
          evaluateTaskWorkload
        })
      }
    }
    return queueTaskList
  }

  const subTasks = getSubtasksUntilMaximumLoad()
  if (subTasks.length > 0) {
    const subTaskPromises = subTasks.map(({ taskPromise }) => taskPromise())
    Promise.all(subTaskPromises).then(() => {
      subTasks.forEach(({ resolve }) => resolve())
    })
  }
}
```

This method works as follows:

1. Iterates through all pending task sets
2. For each subtask in a task set:
   - Checks if maximum load is reached (via `maximumLoad()`)
   - If task state is PENDING:
     - Increases current workload and processing item count
     - Updates task state to PROCESSING
     - Adds task to the execution queue
3. Executes all collected subtasks
4. When a subtask completes:
   - Decreases workload and processing item count
   - Removes completed task from the task set
   - If the task set is empty, resolves the corresponding Promise
   - Recursively calls `processingQueueHandle()` to process more tasks

### 5. Load Check

```typescript
private maximumLoad() {
  return (
    this.processingItemCount >= KnowledgeService.MAXIMUM_PROCESSING_ITEM_COUNT ||
    this.workload >= KnowledgeService.MAXIMUM_WORKLOAD
  )
}
```

This method checks whether maximum load is reached via two conditions:

- Processing item count reaches the limit (30)
- Total workload reaches the limit (80MB)

### 6. Task Addition and Execution Flow

When adding new tasks:

1. Create a task (different tasks for different types)
2. Add the task to the queue via `appendProcessingQueue`
3. Call `processingQueueHandle` to start processing queued tasks

```typescript
private appendProcessingQueue(task: LoaderTask): Promise<LoaderReturn> {
  return new Promise((resolve) => {
    this.knowledgeItemProcessingQueueMappingPromise.set(loaderTaskIntoOfSet(task), () => {
      resolve(task.loaderDoneReturn!)
    })
  })
}
```

## Benefits of This Concurrency Control

1. **Resource Optimization**: Limits concurrent items and total workload to prevent system resource exhaustion
2. **Auto-regulation**: Automatically fetches new tasks from the queue when tasks complete, maintaining efficient resource utilization
3. **Flexibility**: Different task types have different workload estimations, more accurately reflecting actual resource requirements
4. **Reliability**: State management and Promise resolution mechanism ensures tasks complete correctly and notify callers

## Real-world Use Cases

This concurrency control is especially useful when processing large amounts of data:

- Importing large directories that may contain hundreds of files
- Processing large sitemaps with many URLs
- Handling multiple users adding knowledge base items simultaneously
