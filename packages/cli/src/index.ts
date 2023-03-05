#!/usr/bin/env node
import chalk from 'chalk'
import { Generate } from './Generate.js'
import dotenv from 'dotenv'
dotenv.config()

const log = console.log
const error = chalk.bold.red

const commandArray = process.argv.slice(2)

const help = `
  slang <command> [<flags>]

  Commands:
  - generate (build the client based off of locally defined models)
`

async function main() {
  if (!commandArray.length) log(help)
  if (commandArray[0] == 'generate') await Generate.new().parse()
  error('unknown command')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
