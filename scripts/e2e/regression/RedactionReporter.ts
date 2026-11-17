import type { Reporter, TestCase, TestError, TestResult, TestStep } from '@playwright/test/reporter'

import { getSensitiveConfigValues } from './config'
import { createRedactor } from './redaction'

export default class RedactionReporter implements Reporter {
  private readonly redact = createRedactor(getSensitiveConfigValues())

  onStepBegin(_test: TestCase, _result: TestResult, step: TestStep): void {
    step.title = this.redact(step.title)
  }

  onStepEnd(_test: TestCase, _result: TestResult, step: TestStep): void {
    if (step.error) Object.assign(step.error, this.redact(step.error))
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    for (const error of result.errors) Object.assign(error, this.redact(error))
  }

  onError(error: TestError): void {
    Object.assign(error, this.redact(error))
  }
}
