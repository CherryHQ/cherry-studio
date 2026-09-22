import type { BaseConfigItem } from './baseConfigItem'

function acceptConfigItem(item: BaseConfigItem): void {
  void item
}

// @ts-expect-error slider defaults must be numeric
acceptConfigItem({ type: 'slider', key: 'strength', min: 0, max: 1, initialValue: '0.5' })

// @ts-expect-error sliders require both range bounds
acceptConfigItem({ type: 'slider', key: 'strength', initialValue: 0.5 })

// @ts-expect-error input fields cannot carry slider constraints
acceptConfigItem({ type: 'input', key: 'seed', min: 0, max: 10 })

// @ts-expect-error select fields require an option source
acceptConfigItem({ type: 'select', key: 'quality' })

// @ts-expect-error custom-size fields require their backing keys and validation
acceptConfigItem({ type: 'customSize', key: 'customSize' })

function assertDiscriminatedFields(item: BaseConfigItem): void {
  if (item.type === 'slider') {
    const initialValue: number = item.initialValue
    const min: number = item.min
    const max: number = item.max
    void [initialValue, min, max]
  }

  if (item.type === 'select') {
    const options = item.options
    const initialValue: string | undefined = item.initialValue
    void [options, initialValue]
  }

  if (item.type === 'customSize') {
    const widthKey: string = item.widthKey
    const heightKey: string = item.heightKey
    const sizeKey: string = item.sizeKey
    void [widthKey, heightKey, sizeKey, item.validation]
  }
}

void assertDiscriminatedFields
