import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Button } from '../components/ui/button'

interface Props {
  children: ReactNode
  resetKey?: string | number
  onRetry?: () => void
  title: string
  body: string
  retryLabel: string
}

interface State {
  error: Error | null
}

export class SurfaceErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The host owns observability; renderer diagnostics intentionally contain no payload data.
    void error
    void info
  }

  componentDidUpdate(previous: Props): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  private retry = () => {
    this.setState({ error: null })
    this.props.onRetry?.()
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div
        className="rounded-md border border-destructive bg-background p-4 text-foreground"
        role="alert"
        data-a2ui-surface-state="error">
        <p className="font-semibold">{this.props.title}</p>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{this.props.body}</p>
        {this.props.onRetry ? (
          <Button className="mt-3" onClick={this.retry}>
            {this.props.retryLabel}
          </Button>
        ) : null}
      </div>
    )
  }
}
