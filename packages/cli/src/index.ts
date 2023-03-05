#!/usr/bin/env node
import chalk from 'chalk'
import dotenv from 'dotenv'
import { existsSync, mkdirSync } from 'fs'
import path from 'path'
import { ComposeDB } from './composedb/index.js'
dotenv.config()

const ROOT_DIR = '__generated__'

const log = console.log
const error = chalk.bold.red

const slang = function () {
  /*


   .---. ,-.      .--.  .-. .-.  ,--,
  ( .-._)| |     / /\ \ |  \| |.' .'
 (_) \   | |    / /__\ \|   | ||  |  __
 _  \ \  | |    |  __  || |\  |\  \ ( _)
( `-'  ) | `--. | |  |)|| | |)| \  `-) )
 `----'  |( __.'|_|  (_)/(  (_) )\____/
         (_)           (__)    (__)


*/
}
  .toString()
  .split('\n')
  .slice(3, 12)
  .join('\n')

const commandArray = process.argv.slice(2)

const help = `

  slang <command> [<flags>]

  Commands:
  - generate (build the client based off of locally defined models)
`

async function main() {
  if (!existsSync(ROOT_DIR)) {
    mkdirSync(ROOT_DIR)
  }
  if (!commandArray.length) log(help)
  if (commandArray[0] == 'generate') {
    log(chalk.bold.greenBright(slang))
    await ComposeDB.new().parse({ outDir: path.join(ROOT_DIR, 'composedb') })
  }
  error('unknown command')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
