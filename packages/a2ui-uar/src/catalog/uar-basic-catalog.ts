import { Catalog } from '@prometheus-ags/a2ui-core/v0_9'
import {
  ButtonApi,
  CardApi,
  CheckBoxApi,
  ChoicePickerApi,
  ColumnApi,
  DividerApi,
  RowApi,
  TextApi,
  TextFieldApi
} from '@prometheus-ags/a2ui-core/v0_9/basic_catalog'

import { UarButton } from '../components/Button'
import { UarCard } from '../components/Card'
import { UarCheckBox } from '../components/CheckBox'
import { UarChoicePicker } from '../components/ChoicePicker'
import { UarColumn } from '../components/Column'
import { UarDivider } from '../components/Divider'
import { UarRow } from '../components/Row'
import { UarText } from '../components/Text'
import { UarTextField } from '../components/TextField'
import { createUarComponentImplementation } from '../react/create-component'
import type { UarComponentImplementation } from '../react/types'

/**
 * The UAR-approved catalog id for the `uar.a2ui/1` profile
 * (`docs/protocols/a2ui-profile.md`), matching the id UAR's Rust-side
 * `A2uiRegistry` (`src/uar/a2ui/`) advertises via `createSurface.catalogId`
 * (`urn:uar:a2ui:catalog:1`, per
 * `.kbd-orchestrator/phases/uar-grade-a-upgrade-2026-07/analysis.md`).
 */
export const UAR_A2UI_CATALOG_ID = 'urn:uar:a2ui:catalog:1'

/**
 * The 9 protocol-standard components approved by `uar.a2ui/1`
 * (`docs/protocols/a2ui-profile.md`): Text, Button, TextField, CheckBox,
 * ChoicePicker, Row, Column, Card, Divider. This deliberately excludes the
 * rest of `web_core`'s basic_catalog (Image, Icon, Video, AudioPlayer,
 * List, Tabs, Modal, Slider, DateTimeInput) until their URL/content/privacy
 * policies are certified, per the profile doc.
 */
export const uarBasicCatalogComponents: UarComponentImplementation[] = [
  createUarComponentImplementation(TextApi, UarText),
  createUarComponentImplementation(ButtonApi, UarButton),
  createUarComponentImplementation(TextFieldApi, UarTextField),
  createUarComponentImplementation(CheckBoxApi, UarCheckBox),
  createUarComponentImplementation(ChoicePickerApi, UarChoicePicker),
  createUarComponentImplementation(RowApi, UarRow),
  createUarComponentImplementation(ColumnApi, UarColumn),
  createUarComponentImplementation(CardApi, UarCard),
  createUarComponentImplementation(DividerApi, UarDivider)
]

/** The UAR basic catalog: the 9 `uar.a2ui/1` protocol-standard components, rendered with shadcn/ui + react-aria-components. */
export const uarBasicCatalog = new Catalog<UarComponentImplementation>(UAR_A2UI_CATALOG_ID, uarBasicCatalogComponents)
