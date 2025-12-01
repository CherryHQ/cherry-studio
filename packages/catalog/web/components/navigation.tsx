'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

const navigation = [
  { name: 'Models', href: '/' },
  { name: 'Providers', href: '/providers' },
  { name: 'Overrides', href: '/overrides' }
]

export function Navigation() {
  const pathname = usePathname()

  return (
    <nav className="flex space-x-8">
      {navigation.map((item) => (
        <Link
          key={item.name}
          href={item.href}
          className={cn(
            'text-sm font-medium transition-colors hover:text-primary',
            pathname === item.href ? 'text-foreground' : 'text-muted-foreground'
          )}>
          {item.name}
        </Link>
      ))}
    </nav>
  )
}
