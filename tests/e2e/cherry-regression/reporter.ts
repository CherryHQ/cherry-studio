import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter'

import { getRunPaths } from '../../../scripts/cherry-regression-test/paths'
import { beginCase, completeE2eCase, readRun, writeRun } from '../../../scripts/cherry-regression-test/state'

function caseId(test: TestCase): string | undefined {
  return /^\[([^\]]+)]/.exec(test.title)?.[1]
}

function failureSummary(result: TestResult): string {
  const errorText = result.errors
    .map(({ message }) => message ?? '')
    .join('\n')
    .toLowerCase()
  if (result.status === 'timedOut') return '端到端测试未在限定时间内完成，请查看失败截图与 HTML 报告'
  if (result.status === 'skipped') return '端到端测试运行条件不满足，请查看阶段日志'
  if (result.status === 'interrupted') return '端到端测试被工作流中断，请查看阶段日志'
  if (errorText.includes('oauth') || errorText.includes('cherryin')) {
    return 'CherryIN 登录或授权流程失败，请检查账号配置和失败截图'
  }
  if (errorText.includes('file') || errorText.includes('directory') || errorText.includes('no such')) {
    return '文件导入、保存或内容校验失败，请查看失败截图与 HTML 报告'
  }
  if (errorText.includes('process') || errorText.includes('pid')) {
    return '受控子进程未达到预期状态，请查看阶段日志与 HTML 报告'
  }
  if (errorText.includes('locator') || errorText.includes('waiting for') || errorText.includes('timeout')) {
    return '目标页面元素未在限定时间内出现或不可交互，请查看失败截图与 HTML 报告'
  }
  return '页面状态或端到端断言不符合预期，请查看失败截图与 HTML 报告'
}

export default class CherryRegressionReporter implements Reporter {
  private readonly paths = getRunPaths(process.env.CHERRY_TEST_RUN_DIR ?? '')

  onTestBegin(test: TestCase): void {
    const id = caseId(test)
    if (!id) return
    const run = beginCase(readRun(this.paths.runState), id)
    writeRun(this.paths.runState, run)
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const id = caseId(test)
    if (!id) return
    const artifacts = result.attachments.flatMap(({ path }) => (path ? [path] : []))
    const status = result.status === 'passed' ? 'passed' : result.status === 'skipped' ? 'blocked' : 'failed'
    const summary =
      result.status === 'passed'
        ? `端到端测试通过，耗时 ${Math.ceil(result.duration / 1000)} 秒`
        : failureSummary(result)
    const run = completeE2eCase(readRun(this.paths.runState), id, status, summary, artifacts)
    writeRun(this.paths.runState, run)
  }

  onEnd(result: FullResult): void {
    process.stdout.write(`端到端测试阶段结论：${result.status === 'passed' ? '通过' : '未通过'}\n`)
  }
}
