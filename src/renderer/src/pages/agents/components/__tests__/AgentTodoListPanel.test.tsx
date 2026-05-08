import { fireEvent, render, screen } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'

import AgentTodoListPanel from '../AgentTodoListPanel'

const translations: Record<string, string> = {
  'agent.todo.mock.actions.complete': 'Complete',
  'agent.todo.mock.actions.dismiss': 'Dismiss',
  'agent.todo.mock.details.addRouter.summary': 'Configuring client routing with react-router-dom v6...',
  'agent.todo.mock.details.addRouter.title': 'Add React Router',
  'agent.todo.mock.details.configureProject.resources.createdMeta': 'created',
  'agent.todo.mock.details.configureProject.resources.postcssConfig': 'postcss.config.js',
  'agent.todo.mock.details.configureProject.resources.tailwindConfig': 'tailwind.config.js',
  'agent.todo.mock.details.configureProject.resources.updatedMeta': 'updated',
  'agent.todo.mock.details.configureProject.resources.viteConfig': 'vite.config.ts - port 3001',
  'agent.todo.mock.details.configureProject.title': 'Configure project',
  'agent.todo.mock.details.installDependencies.resources.dependenciesMeta': 'dependencies',
  'agent.todo.mock.details.installDependencies.resources.devDependenciesMeta': 'devDependencies',
  'agent.todo.mock.details.installDependencies.resources.reactDeps': 'react@18.3.1, react-dom@18.3.1',
  'agent.todo.mock.details.installDependencies.resources.tailwindDeps': 'tailwindcss@3.4.4, postcss@8.4.38',
  'agent.todo.mock.details.installDependencies.resources.typescriptDeps': 'typescript@5.4.5, vite@5.3.0',
  'agent.todo.mock.details.installDependencies.summary':
    'Installed react, react-dom, tailwindcss, postcss, autoprefixer, and TypeScript.',
  'agent.todo.mock.details.installDependencies.title': 'Install dependencies',
  'agent.todo.mock.details.reviewReferences.collectionTitle': 'Reviewed references',
  'agent.todo.mock.details.reviewReferences.resources.npmCreateVite': 'npm create vite - Official Scaffolding',
  'agent.todo.mock.details.reviewReferences.resources.npmMeta': 'npmjs.com',
  'agent.todo.mock.details.reviewReferences.resources.reactDocs': 'React Documentation - Quick Start',
  'agent.todo.mock.details.reviewReferences.resources.reactMeta': 'react.dev',
  'agent.todo.mock.details.reviewReferences.resources.tailwindDocs': 'Tailwind CSS - Installation Guide',
  'agent.todo.mock.details.reviewReferences.resources.tailwindMeta': 'tailwindcss.com',
  'agent.todo.mock.details.reviewReferences.resources.viteDocs': 'Vite - Next Generation Frontend Tooling',
  'agent.todo.mock.details.reviewReferences.resources.viteMeta': 'vitejs.dev',
  'agent.todo.mock.details.reviewReferences.title': 'Review references',
  'agent.todo.mock.details.searchWeb.resources.reactViteQuery': 'React Vite TypeScript starter 2025 best practices',
  'agent.todo.mock.details.searchWeb.summary':
    'Collected current references for React + Vite scaffolding and best practices.',
  'agent.todo.mock.details.searchWeb.title': 'Search web references',
  'agent.todo.mock.details.title': 'Execution details',
  'agent.todo.mock.details.writeComponents.collectionTitle': 'Created files',
  'agent.todo.mock.details.writeComponents.resources.app': 'src/App.tsx',
  'agent.todo.mock.details.writeComponents.resources.button': 'src/components/Button.tsx',
  'agent.todo.mock.details.writeComponents.resources.card': 'src/components/Card.tsx',
  'agent.todo.mock.details.writeComponents.resources.footer': 'src/components/Footer.tsx',
  'agent.todo.mock.details.writeComponents.resources.header': 'src/components/Header.tsx',
  'agent.todo.mock.details.writeComponents.resources.layout': 'src/components/Layout.tsx',
  'agent.todo.mock.details.writeComponents.resources.modifiedMeta': 'modified',
  'agent.todo.mock.details.writeComponents.resources.newMeta': 'new',
  'agent.todo.mock.details.writeComponents.resources.updatedMeta': 'updated',
  'agent.todo.mock.details.writeComponents.title': 'Write components',
  'agent.todo.mock.details.writePages.resources.about': 'src/pages/About.tsx',
  'agent.todo.mock.details.writePages.resources.home': 'src/pages/Home.tsx',
  'agent.todo.mock.details.writePages.resources.newMeta': 'new',
  'agent.todo.mock.details.writePages.title': 'Write pages',
  'agent.todo.mock.progress': '{{completed}}/{{total}} tasks completed',
  'agent.todo.mock.tasks.addLinting': 'Add ESLint + Prettier',
  'agent.todo.mock.tasks.addRouter': 'Add React Router',
  'agent.todo.mock.tasks.buildDeploy': 'Build and deploy',
  'agent.todo.mock.tasks.configureProject': 'Configure project',
  'agent.todo.mock.tasks.finish': 'Finish',
  'agent.todo.mock.tasks.installDependencies': 'Install dependencies',
  'agent.todo.mock.tasks.reviewReferences': 'Review references',
  'agent.todo.mock.tasks.searchWeb': 'Search web references',
  'agent.todo.mock.tasks.writeComponents': 'Write components',
  'agent.todo.mock.tasks.writePages': 'Write pages',
  'agent.todo.mock.title': 'Tasks'
}

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    ...props
  }: PropsWithChildren<{ disabled?: boolean; onClick?: React.MouseEventHandler<HTMLButtonElement> }>) => (
    <button type="button" disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: PropsWithChildren<{ content?: React.ReactNode }>) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, number>) => {
      let text = translations[key] ?? key

      if (values) {
        for (const [name, value] of Object.entries(values)) {
          text = text.replace(`{{${name}}}`, String(value))
        }
      }

      return text
    }
  })
}))

describe('AgentTodoListPanel', () => {
  it('renders the default mock task panel', () => {
    render(<AgentTodoListPanel />)

    expect(screen.getByRole('button', { name: /tasks 6\/10/i })).toBeInTheDocument()
    expect(screen.getAllByText('Search web references')).toHaveLength(2)
    expect(screen.getAllByText('Add React Router')).toHaveLength(2)
    expect(screen.getByText('Add ESLint + Prettier')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /execution details/i })).toBeInTheDocument()
    expect(screen.getByText('6/10 tasks completed')).toBeInTheDocument()
  })

  it('collapses and expands the task list', () => {
    render(<AgentTodoListPanel />)

    const taskToggle = screen.getByRole('button', { name: /tasks 6\/10/i })
    expect(screen.getByText('Add ESLint + Prettier')).toBeInTheDocument()

    fireEvent.click(taskToggle)
    expect(screen.queryByText('Add ESLint + Prettier')).not.toBeInTheDocument()

    fireEvent.click(taskToggle)
    expect(screen.getByText('Add ESLint + Prettier')).toBeInTheDocument()
  })

  it('collapses and expands the execution details', () => {
    render(<AgentTodoListPanel />)

    const detailsToggle = screen.getByRole('button', { name: /execution details/i })
    expect(screen.getByText('React Vite TypeScript starter 2025 best practices')).toBeInTheDocument()

    fireEvent.click(detailsToggle)
    expect(screen.queryByText('React Vite TypeScript starter 2025 best practices')).not.toBeInTheDocument()

    fireEvent.click(detailsToggle)
    expect(screen.getByText('React Vite TypeScript starter 2025 best practices')).toBeInTheDocument()
  })
})
