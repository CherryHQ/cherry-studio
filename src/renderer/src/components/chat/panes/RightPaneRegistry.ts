import type { ReactNode } from 'react'

export interface RightPaneDescriptor<Payload = unknown> {
  id: string
  title: ReactNode | ((payload: Payload) => ReactNode)
  render: (payload: Payload) => ReactNode
}

export type RightPaneRegistration = () => void

export class RightPaneRegistry {
  private readonly descriptors = new Map<string, RightPaneDescriptor>()

  register<Payload>(descriptor: RightPaneDescriptor<Payload>): RightPaneRegistration {
    this.descriptors.set(descriptor.id, descriptor as RightPaneDescriptor)

    return () => {
      if (this.descriptors.get(descriptor.id) === descriptor) {
        this.descriptors.delete(descriptor.id)
      }
    }
  }

  unregister(id: string): void {
    this.descriptors.delete(id)
  }

  get<Payload = unknown>(id: string): RightPaneDescriptor<Payload> | undefined {
    return this.descriptors.get(id) as RightPaneDescriptor<Payload> | undefined
  }

  list(): RightPaneDescriptor[] {
    return Array.from(this.descriptors.values())
  }

  clear(): void {
    this.descriptors.clear()
  }
}

export function createRightPaneRegistry(): RightPaneRegistry {
  return new RightPaneRegistry()
}
