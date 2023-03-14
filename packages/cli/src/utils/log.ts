import chalk from 'chalk'

export const log = console.log
export const emphasis = (s: string) => chalk.bold.green(s)
export const normal = (s: string) => chalk.white(s)
export const detail = (s: string) => chalk.dim.gray(` >>> ${s}`)
export const error = (s: string) => chalk.bold.redBright(s)
