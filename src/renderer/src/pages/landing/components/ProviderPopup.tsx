import GeneralPopup from '@renderer/components/Popups/GeneralPopup'
import ProviderList from '@renderer/pages/settings/ProviderSettings/ProviderList'
import { MemoryRouter } from 'react-router-dom'

export default class ProviderPopup {
  static show() {
    return GeneralPopup.show({
      title: '选择其他服务商',
      content: (
        <MemoryRouter>
          <ProviderList />
        </MemoryRouter>
      ),
      footer: null,
      width: 900,
      styles: {
        header: {
          borderBottom: '1px solid var(--color-border)',
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          paddingBottom: 12,
          paddingTop: 12,
          marginBottom: 0
        },
        body: { padding: 0, height: '70vh', display: 'flex' },
        content: { paddingBottom: 0 }
      }
    })
  }

  static hide() {
    GeneralPopup.hide()
  }
}
