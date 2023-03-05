import chalk from 'chalk'
import { ComposeDB } from './composedb/index.js'

const log = console.log
const error = chalk.bold.red

export class Generate {
  public static new(): Generate {
    return new Generate()
  }

  parse = async () => {
    await this.run()
  }

  private run = async () => {
    await ComposeDB.new().parse()
  }
}
