require('./win-sign')
  .default({ path: process.argv[2] })
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
