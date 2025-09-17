import type { Meta, StoryObj } from '@storybook/react-vite'

import Scrollbar from '../../../src/components/layout/Scrollbar'

const meta: Meta<typeof Scrollbar> = {
  title: 'Layout/Scrollbar',
  component: Scrollbar,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

// Default example
export const Default: Story = {
  args: {
    children: (
      <div className="p-4">
        {Array.from({ length: 50 }, (_, i) => (
          <p key={i} className="mb-2">
            Line {i + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit.
          </p>
        ))}
      </div>
    )
  },
  decorators: [
    (Story) => (
      <div className="w-96 h-64 border border-gray-300 rounded">
        <Story />
      </div>
    )
  ]
}

// With Cards
export const WithCards: Story = {
  args: {
    children: (
      <div className="p-4 space-y-4">
        {Array.from({ length: 20 }, (_, i) => (
          <div key={i} className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
            <h3 className="mb-2 text-lg font-semibold">Card {i + 1}</h3>
            <p className="text-sm text-gray-600">
              This is a sample card with some content to demonstrate scrolling behavior.
            </p>
          </div>
        ))}
      </div>
    )
  },
  decorators: [
    (Story) => (
      <div className="w-96 h-96 bg-gray-50 rounded-lg">
        <Story />
      </div>
    )
  ]
}

// Horizontal Layout
export const HorizontalContent: Story = {
  args: {
    children: (
      <div className="p-4">
        <div className="flex gap-4 mb-4">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="min-w-[150px] p-3 bg-blue-100 rounded">
              Column {i + 1}
            </div>
          ))}
        </div>
        {Array.from({ length: 30 }, (_, i) => (
          <p key={i} className="mb-2">
            Row {i + 1}: Additional content to enable vertical scrolling
          </p>
        ))}
      </div>
    )
  },
  decorators: [
    (Story) => (
      <div className="w-[500px] h-80 border border-gray-300 rounded overflow-x-auto">
        <Story />
      </div>
    )
  ]
}

// Interactive List
export const InteractiveList: Story = {
  render: () => {
    const handleScroll = () => {
      console.log('Scrolling...')
    }

    return (
      <div className="w-96 h-64 border border-gray-300 rounded">
        <Scrollbar onScroll={handleScroll}>
          <div className="p-4">
            {Array.from({ length: 30 }, (_, i) => (
              <div
                key={i}
                className="mb-2 p-3 bg-gray-100 rounded cursor-pointer hover:bg-gray-200 transition-colors"
                onClick={() => alert(`Clicked item ${i + 1}`)}>
                Interactive Item {i + 1}
              </div>
            ))}
          </div>
        </Scrollbar>
      </div>
    )
  }
}

// Code Block
export const CodeBlock: Story = {
  args: {
    children: (
      <pre className="p-4 font-mono text-sm">
        {`function calculateTotal(items) {
  let total = 0;

  for (const item of items) {
    if (item.price && item.quantity) {
      total += item.price * item.quantity;
    }
  }

  return total;
}

const items = [
  { name: 'Apple', price: 0.5, quantity: 10 },
  { name: 'Banana', price: 0.3, quantity: 15 },
  { name: 'Orange', price: 0.6, quantity: 8 },
  { name: 'Grape', price: 2.0, quantity: 3 },
  { name: 'Watermelon', price: 5.0, quantity: 1 }
];

const totalCost = calculateTotal(items);
console.log('Total cost:', totalCost);

// More code to demonstrate scrolling
class ShoppingCart {
  constructor() {
    this.items = [];
  }

  addItem(item) {
    this.items.push(item);
  }

  removeItem(name) {
    this.items = this.items.filter(item => item.name !== name);
  }

  getTotal() {
    return calculateTotal(this.items);
  }

  checkout() {
    const total = this.getTotal();
    if (total > 0) {
      console.log('Processing payment...');
      return true;
    }
    return false;
  }
}`}
      </pre>
    )
  },
  decorators: [
    (Story) => (
      <div className="w-[600px] h-96 bg-gray-900 text-green-400 rounded-lg overflow-hidden">
        <Story />
      </div>
    )
  ]
}

// Long Article
export const LongArticle: Story = {
  args: {
    children: (
      <article className="p-6 max-w-prose">
        <h1 className="mb-4 text-2xl font-bold">The Art of Scrolling</h1>

        <p className="mb-4">
          Scrolling is a fundamental interaction pattern in user interfaces. It allows users to navigate through content
          that exceeds the visible viewport, making it possible to present large amounts of information in a limited
          space.
        </p>

        <h2 className="mb-3 text-xl font-semibold">History of Scrolling</h2>
        <p className="mb-4">
          The concept of scrolling dates back to the early days of computing, when terminal displays could only show a
          limited number of lines. As content grew beyond what could fit on a single screen, the need for scrolling
          became apparent.
        </p>

        <h2 className="mb-3 text-xl font-semibold">Types of Scrolling</h2>
        <ul className="mb-4 ml-6 list-disc">
          <li className="mb-2">Vertical Scrolling - The most common type</li>
          <li className="mb-2">Horizontal Scrolling - Often used for timelines and galleries</li>
          <li className="mb-2">Infinite Scrolling - Continuously loads new content</li>
          <li className="mb-2">Parallax Scrolling - Creates depth through different scroll speeds</li>
        </ul>

        <h2 className="mb-3 text-xl font-semibold">Best Practices</h2>
        <p className="mb-4">When implementing scrolling in your applications, consider the following best practices:</p>

        <ol className="mb-4 ml-6 list-decimal">
          <li className="mb-2">Always provide visual feedback for scrollable areas</li>
          <li className="mb-2">Ensure scroll performance is smooth and responsive</li>
          <li className="mb-2">Consider keyboard navigation for accessibility</li>
          <li className="mb-2">Use appropriate scroll indicators</li>
          <li className="mb-2">Test on various devices and screen sizes</li>
        </ol>

        <p className="mb-4">
          Modern web technologies have made it easier than ever to implement sophisticated scrolling behaviors. CSS
          properties like scroll-behavior and overscroll-behavior provide fine-grained control over the scrolling
          experience.
        </p>

        <h2 className="mb-3 text-xl font-semibold">Performance Considerations</h2>
        <p className="mb-4">
          Scrolling performance is crucial for user experience. Poor scrolling performance can make an application feel
          sluggish and unresponsive. Key factors affecting scroll performance include:
        </p>

        <ul className="mb-4 ml-6 list-disc">
          <li className="mb-2">DOM complexity and size</li>
          <li className="mb-2">CSS animations and transforms</li>
          <li className="mb-2">JavaScript event handlers</li>
          <li className="mb-2">Image loading and rendering</li>
        </ul>

        <p className="mb-4">
          To optimize scrolling performance, consider using techniques like virtual scrolling for large lists,
          debouncing scroll event handlers, and leveraging CSS transforms for animations.
        </p>
      </article>
    )
  },
  decorators: [
    (Story) => (
      <div className="w-[600px] h-96 bg-white border border-gray-300 rounded-lg">
        <Story />
      </div>
    )
  ]
}
