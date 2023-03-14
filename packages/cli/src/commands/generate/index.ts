import { CeramicClient } from '@ceramicnetwork/http-client'
import {
  mergeEncodedComposites,
  readEncodedComposite,
  writeEncodedCompositeRuntime,
} from '@composedb/devtools-node'
import chalk from 'chalk'
import { Command } from 'commander'
import { DID } from 'dids'
import { existsSync, mkdirSync } from 'fs'
import { readdir } from 'fs/promises'
import { Ed25519Provider } from 'key-did-provider-ed25519'
import { getResolver } from 'key-did-resolver'
import path from 'path'
// @ts-ignore
import { fromString } from 'uint8arrays/from-string'
import { SLANG_MESSAGE } from '../../index.js'
import { detail, emphasis, log } from '../../utils/log.js'
import { client } from './client.js'
import { codegen } from './codegen.js'
import { parseGraphqlModels } from './composites.js'
import { prisma } from './prisma.js'

export interface GenerateOptions {
  composedbNodeUrl: string
  composedbPostgresUrl: string
  composedbPrivateKey: string
  outputDir: string
  modelDir: string
  dryRun: boolean
}

export default () => {
  const cmd = new Command()
  cmd
    .name('generate')
    .description(
      `
  generate a client based on model definitions`
    )
    .requiredOption(
      '-n, --composedb-node-url <url>, COMPOSEDB_NODE_URL',
      'composedb endpoint',
      process.env.COMPOSEDB_NODE_URL
    )
    .requiredOption(
      '-p, --composedb-postgres-url <url>, COMPOSEDB_POSTGRES_URL',
      'composedb postgres endpoint',
      process.env.COMPOSEDB_POSTGRES_URL
    )
    .requiredOption(
      '-k, --composedb-private-key <private-key>, COMPOSEDB_PRIVATE_KEY',
      'composedb admin did private key',
      process.env.COMPOSEDB_PRIVATE_KEY
    )
    .option('-o, --output-dir <path>', 'output directory', '__generated__')
    .option('-m, --model-dir <path>', 'model source directory', 'models')
    .option('-d, --dryRun', 'run without deploying', false)
    .action(async () => {
      log(emphasis(SLANG_MESSAGE))

      const options = cmd.opts() as GenerateOptions

      log(`initializing directories...`)
      if (!existsSync(options.outputDir)) {
        mkdirSync(options.outputDir)
      }

      log(
        `connecting to ceramic client at ${chalk.green(
          options.composedbNodeUrl
        )}...`
      )
      const ceramic = new CeramicClient(options.composedbNodeUrl)

      log(`authenticating ceramic client...`)
      const key = fromString(options.composedbPrivateKey, 'base16')
      const did = new DID({
        resolver: getResolver(),
        provider: new Ed25519Provider(key),
      })
      await did.authenticate()
      ceramic.did = did

      log(
        `reading models from ${path.join(process.cwd(), options.modelDir)}/...`
      )
      const fileNames = (await readdir(options.modelDir)).map((f) =>
        path.join(process.cwd(), options.modelDir, f)
      )
      const { paths } = await parseGraphqlModels(
        ceramic,
        fileNames,
        options,
        (s) => log(detail(s))
      )

      log(`combining composites...`)
      const compositeDir = path.join(options.outputDir, 'composites')
      await mergeEncodedComposites(
        ceramic,
        paths,
        path.join(compositeDir, 'index.json')
      )
      log(`writing composite and graphql schema...`)
      await writeEncodedCompositeRuntime(
        ceramic,
        path.join(compositeDir, 'index.json'),
        path.join(compositeDir, 'index.ts'),
        path.join(options.outputDir, 'schema.graphql')
      )
      if (!options.dryRun) {
        log(`deploying composites...`)
        const deployComposite = await readEncodedComposite(
          ceramic,
          path.join(compositeDir, 'index.json'),
          true
        )
        log(`beginning indexing...`)
        await deployComposite.startIndexingOn(ceramic)
        log(`deploy complete.`)
      }
      // load the combined runtime model definition for codegen + prisma
      const definition = (
        await readEncodedComposite(
          ceramic,
          path.join(compositeDir, 'index.json'),
          !options.dryRun
        )
      ).toRuntime()

      log(`running codegen...`)
      await codegen(definition, options, (s) => log(detail(s)))
      log(`codegen complete`)

      log(`running prisma...`)
      await prisma(definition, options, (s) => log(detail(s)))
      log(`prisma complete`)

      log(`generating client...`)
      await client(definition, options)
      log(`client complete.`)
    })
  return cmd
}
