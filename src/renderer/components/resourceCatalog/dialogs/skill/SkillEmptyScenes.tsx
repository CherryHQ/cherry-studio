import { Download, Folder, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  EmptyStateScene,
  SceneBar,
  SceneChip,
  SceneGhostRow,
  SceneHeader,
  SceneInput,
  ScenePanel,
  SceneRow
} from '@cherrystudio/ui'

/** Online skill search before or after a miss: the focused search field, its sources, empty result rows. */
export function SkillMarketplaceEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={8}
      sprites={[
        { x: 232, y: 3, color: 5, shape: 'checker', tilt: 10 },
        { x: 4, y: 82, color: 3, shape: 'cross', tilt: -12 },
        { x: 240, y: 120, color: 8, shape: 'ring', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[10px] left-[18px] h-[190px] w-[224px] gap-[8px] px-[12px] pt-[14px]">
        <SceneInput icon={Search} focused caret placeholder={t('library.skill_marketplace.search_placeholder')} />
        <span className="pt-[2px] text-[6.5px] text-foreground-tertiary">
          {t('library.skill_marketplace.source_label')}
        </span>
        <div className="flex gap-[5px]">
          {['w-[30px]', 'w-[26px]', 'w-[20px]'].map((width) => (
            <SceneChip key={width} label={<SceneBar className={width} />} />
          ))}
        </div>
        <SceneGhostRow lead />
        <SceneGhostRow lead />
        <SceneGhostRow lead />
      </ScenePanel>
    </EmptyStateScene>
  )
}

const SOURCE_WIDTHS = ['w-[54px]', 'w-[36px]', 'w-[40px]', 'w-[48px]']

/** Nothing importable: each local coding tool's skills folder, all at zero. */
export function SystemSkillEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={5}
      sprites={[
        { x: 232, y: 3, color: 7, shape: 'corner', tilt: 10 },
        { x: 4, y: 86, color: 1, shape: 'checker', tilt: -12 },
        { x: 240, y: 122, color: 5, shape: 'cross', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[10px] left-[18px] h-[190px] w-[224px]">
        <SceneHeader
          icon={Download}
          title={t('library.system_skill.title')}
          trailing={<SceneChip accent label="0" />}
        />
        <div className="flex flex-col gap-[5px] px-[8px] pt-[9px]">
          {SOURCE_WIDTHS.map((width) => (
            <SceneRow key={width} icon={Folder} label={<SceneBar className={width} />} meta="0" />
          ))}
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
