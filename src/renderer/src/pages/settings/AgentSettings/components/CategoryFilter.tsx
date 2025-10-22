import { Chip } from '@heroui/react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

export interface CategoryFilterProps {
  categories: string[]
  selectedCategories: string[]
  onChange: (categories: string[]) => void
}

export const CategoryFilter: FC<CategoryFilterProps> = ({ categories, selectedCategories, onChange }) => {
  const { t } = useTranslation()

  const isAllSelected = selectedCategories.length === 0

  const handleCategoryClick = (category: string) => {
    if (selectedCategories.includes(category)) {
      onChange(selectedCategories.filter((c) => c !== category))
    } else {
      onChange([...selectedCategories, category])
    }
  }

  const handleAllClick = () => {
    onChange([])
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Chip
        variant={isAllSelected ? 'solid' : 'bordered'}
        color={isAllSelected ? 'primary' : 'default'}
        onClick={handleAllClick}
        className="cursor-pointer">
        {t('plugins.all_categories')}
      </Chip>

      {categories.map((category) => {
        const isSelected = selectedCategories.includes(category)
        return (
          <Chip
            key={category}
            variant={isSelected ? 'solid' : 'bordered'}
            color={isSelected ? 'primary' : 'default'}
            onClick={() => handleCategoryClick(category)}
            className="cursor-pointer">
            {category}
          </Chip>
        )
      })}
    </div>
  )
}
