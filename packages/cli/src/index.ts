#!/usr/bin/env node
import { Command } from 'commander'
import dotenv from 'dotenv'
import pkgJSON from '../package.json' assert { type: 'json' }
import generateCommand from './commands/generate/index.js'
import { emphasis } from './utils/log.js'

dotenv.config()

export const SLANG_MESSAGE = function () {
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

const slang = new Command()

slang
  .name('slang')
  .addHelpText('beforeAll', emphasis(SLANG_MESSAGE))
  .version(pkgJSON.version)

slang.addCommand(generateCommand())

slang.parse()
