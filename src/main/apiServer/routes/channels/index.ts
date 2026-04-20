import express, { type Router } from 'express'

import * as channelHandlers from './handlers'

const channelsRouter: Router = express.Router()

channelsRouter.post('/', channelHandlers.createChannel)
channelsRouter.get('/', channelHandlers.listChannels)
channelsRouter.get('/:channelId', channelHandlers.getChannel)
channelsRouter.patch('/:channelId', channelHandlers.updateChannel)
channelsRouter.delete('/:channelId', channelHandlers.deleteChannel)

export { channelsRouter }
