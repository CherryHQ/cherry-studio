#!/usr/bin/env node
const { dirname, join } = require('node:path')

require(join(dirname(process.argv[1]), 'scenario.cjs'))
