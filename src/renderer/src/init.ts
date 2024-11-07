import KeyvStorage from '@kangfenmao/keyv-storage'
import localforage from 'localforage'

import { APP_NAME } from './config/env'

function init() {
  localforage.config({
    driver: localforage.INDEXEDDB,
    name: 'CherryAI',
    version: 1.0,
    storeName: 'cherryai',
    description: `${APP_NAME} Storage`
  })

  window.keyv = new KeyvStorage()
  window.keyv.init()
}

init()
