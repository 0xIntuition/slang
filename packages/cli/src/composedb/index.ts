import { CeramicClient } from '@ceramicnetwork/http-client'
import chalk from 'chalk'
import chalkAnimation from 'chalk-animation'
// @ts-ignore
import { fromString } from 'uint8arrays/from-string'
import { DID } from 'dids'
import { Ed25519Provider } from 'key-did-provider-ed25519'
import { getResolver } from 'key-did-resolver'
import { readdir, readFile, writeFile } from 'fs/promises'
import { Composite } from '@composedb/devtools'
import path from 'path'
import {
  mergeEncodedComposites,
  readEncodedComposite,
  writeEncodedComposite,
  writeEncodedCompositeRuntime,
} from '@composedb/devtools-node'
import { RuntimeCompositeDefinition } from '@composedb/types'
import { parse, visit } from 'graphql'
import { execSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { typeFlag } from 'type-flag'
import { CodegenConfig, generate } from '@graphql-codegen/cli'
import { CodegenPlugin } from '@graphql-codegen/plugin-helpers'
import * as typescriptPlugin from '@graphql-codegen/typescript'
import * as typescriptOperationsPlugin from '@graphql-codegen/typescript-operations'
import * as typescriptValidationPlugin from 'graphql-codegen-typescript-validation-schema'
import * as addPlugin from '@graphql-codegen/add'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const log = console.log
const error = chalk.bold.red
const animate = chalkAnimation.glitch

export const ComposeDBFlags = typeFlag({
  outDir: {
    type: String,
    default: path.join(process.cwd(), '__generated__'),
  },
  modelFolder: {
    type: String,
    default: 'models',
  },
  compositeFolder: {
    type: String,
    default: 'composites',
  },
  prismaFolder: {
    type: String,
    default: process.cwd(),
  },
  clientFolder: {
    type: String,
    default: 'composedb',
  },
  deploy: {
    type: Boolean,
    default: false,
  },
  codegen: {
    type: Boolean,
    default: true,
  },
  prisma: {
    type: Boolean,
    default: true,
  },
  client: {
    type: Boolean,
    default: true,
  },
})

export interface ComposeDBArgs {
  outDir: string
  modelFolder: string
  compositeFolder: string
  prismaFolder: string
  clientFolder: string
  deploy: boolean
  codegen: boolean
  prisma: boolean
  client: boolean
}

export class ComposeDB {
  public static new(): ComposeDB {
    return new ComposeDB()
  }

  parse = async (args?: Partial<ComposeDBArgs>) => {
    // ensure environment variables are present
    if (!process.env.COMPOSEDB_NODE_URL) {
      log(error('must define COMPOSEDB_NODE_URL'))
    }
    if (!process.env.COMPOSEDB_PRIVATE_KEY) {
      log(error('must define COMPOSEDB_PRIVATE_KEY'))
    }
    if (!process.env.COMPOSEDB_POSTGRES_URL) {
      log(error('COMPOSEDB_POSTGRES_URL'))
    }
    await this.run({ ...ComposeDBFlags.flags, ...args })
  }

  private run = async (args: ComposeDBArgs) => {
    log(`initializing directories...`)
    if (!existsSync(args.outDir)) {
      mkdirSync(args.outDir)
    }
    log(`connecting to ceramic client at ${process.env.COMPOSEDB_NODE_URL}...`)
    const ceramic = new CeramicClient(process.env.COMPOSEDB_NODE_URL)

    log(`authenticating ceramic client...`)
    const key = fromString(process.env.COMPOSEDB_PRIVATE_KEY, 'base16')
    const did = new DID({
      resolver: getResolver(),
      provider: new Ed25519Provider(key),
    })
    await did.authenticate()
    ceramic.did = did

    const modelDir = path.join(process.cwd(), args.modelFolder)
    log(`reading models from ${modelDir}...`)
    const fileNames = await readdir(args.modelFolder)
    const embeds: string[] = []
    let composites: { [key: string]: Composite } = {}
    const paths: string[] = []
    for (const fileName of fileNames) {
      log(` - parsing ${fileName}...`)
      let content = await readFile(path.join(modelDir, fileName), 'utf-8')
      const gql = parse(content)
      let names: string[] = []
      // traverse nodes to find shared objects
      visit(gql, {
        ObjectTypeDefinition: {
          enter: (node) => {
            // pick root objects with no directives
            if (
              !node.directives?.map((d) => d.name.value).length &&
              node.loc?.source.body
            )
              embeds.push(
                node.loc.source.body.slice(node.loc.start, node.loc.end)
              )
            // record the names of all models to be created
            if (node.directives?.map((d) => d.name.value)[0] == 'createModel') {
              names.push(node.name.value)
            }
          },
        },
      })
      // replace any dependent objects with the correct modelId
      const matches = content.match(/\${\S*}/gm)
      if (matches) {
        for (const k of Object.keys(composites)) {
          if (!(k in composites))
            throw new Error(
              `error: ${fileName} references model ${k} before it's been deployed`
            )
          log(` - filling reference to model ${k} in ${fileName}`)
          content = content.replaceAll(
            '${' + k + '}',
            composites[k].toRuntime().models[k].id
          )
        }
      }
      // generate the composite
      for (const name of names) {
        const { composite, compositePath } = await this.generateComposite(
          {
            name,
            ceramic,
            content: embeds.join('\n') + '\n' + content, // include embeds with everything to be safe
          },
          args
        )
        composites[name] = composite
        paths.push(compositePath)
        log(`created composite ${name}`)
      }
    }
    log(`combining composites...`)
    const compositeDir = path.join(args.outDir, args.compositeFolder)
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
      path.join(args.outDir, 'schema.graphql')
    )
    if (args.deploy) {
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
        args.deploy
      )
    ).toRuntime()
    if (args.codegen) {
      log(`running codegen...`)
      await this.codegen(definition, args)
    }
    if (args.prisma) {
      log(`running prisma...`)
      await this.prisma(definition, args)
    }
    if (args.client) {
      log(`generating client...`)
      await this.client(definition, args)
    }
  }

  private generateComposite = async (
    {
      name,
      content,
      ceramic,
    }: { name: string; content: string; ceramic: CeramicClient },
    args: ComposeDBArgs
  ) => {
    log(`generating composite ${name}...`)
    let composite = await Composite.create({
      ceramic,
      schema: content,
      index: args.deploy,
    })
    // set human-readable alias
    composite = composite.setAliases({
      [name]: composite.toRuntime().models[name].id,
    })
    const compositePath = path.join(
      args.outDir,
      args.compositeFolder,
      `${name}.json`
    )
    await writeEncodedComposite(composite, compositePath)
    return { composite, compositePath }
  }

  private codegen = async (
    definition: RuntimeCompositeDefinition,
    args: ComposeDBArgs
  ) => {
    log(`generating graphql mutations...`)
    let queryContent = `
    import { gql } from 'graphql-tag'
    `
    for (const m of Object.keys(definition.models)) {
      log(`- forming mutations for model ${m}`)
      queryContent += `
      export const Create${m}Document = gql\`
        mutation Create${m}($input: Create${m}Input!) {
          create${m}(input: $input) {
            document {
              id
            }
          }
        }
      \`
      export const Update${m}Document = gql\`
        mutation Update${m}($input: Update${m}Input!) {
          update${m}(input: $input) {
            document {
              id
            }
          }
        }
      \`
      `
    }
    const mutationFile = path.join(args.outDir, 'mutations.ts')
    await writeFile(mutationFile, queryContent)
    log(`wrote mutations to ${mutationFile}`)
    log(`running graphql codegen...`)
    const config: CodegenConfig = {
      schema: path.join(args.outDir, 'schema.graphql'),
      documents: [args.outDir],
      pluginLoader: (name: string): CodegenPlugin => {
        switch (name) {
          case '@graphql-codegen/typescript':
            return typescriptPlugin
          case '@graphql-codegen/typescript-operations':
            return typescriptOperationsPlugin
          case '@graphql-codegen/add':
            return addPlugin
          case '@graphql-codegen/typescript-validation-schema':
            return typescriptValidationPlugin
          default:
            throw Error(`couldn't find plugin ${name}`)
        }
      },
      config: {
        namingConvention: 'keep',
      },
      generates: {
        [path.join(args.outDir, 'types.ts')]: {
          plugins: [
            {
              add: {
                content: `
// THIS FILE IS GENERATED, DO NOT EDIT!
import { DID } from 'dids'
              `,
              },
            },
            'typescript',
            'typescript-operations',
          ],
          config: {
            scalars: {
              CeramicCommitID: 'string',
              CeramicStreamID: 'string',
              Date: 'string',
              DateTime: 'string',
              DID: 'any',
            },
            skipTypeName: true,
            strictScalars: true,
            declarationKind: 'interface',
          },
        },
        [path.join(args.outDir, 'validation.ts')]: {
          plugins: [
            {
              add: {
                content: `
// THIS FILE IS GENERATED, DO NOT EDIT!
                `,
              },
            },
            'typescript-validation-schema',
          ],
          config: {
            importFrom: './types.js',
            schema: 'zod',
            scalarSchemas: {
              Date: 'z.string().datetime()',
              DateTime: 'z.string().datetime()',
            },
            directives: {
              string: {
                minLength: 'min',
                maxLength: 'max',
              },
            },
          },
        },
        [path.join(args.outDir, 'index.ts')]: {
          plugins: [
            {
              add: {
                content: `
export * from './${path.join(args.compositeFolder, 'index.js')}'
export * from './${path.join('types.js')}'
export * from './${path.join('validation.js')}'
export * from './${path.join('mutations.js')}'
export * from './${path.join(args.clientFolder, 'index.js')}'
              `,
              },
            },
          ],
        },
      },
    }
    await generate(config, true)
    log(`codegen complete`)
  }

  private prisma = async (
    definition: RuntimeCompositeDefinition,
    args: ComposeDBArgs
  ) => {
    log(`generating prisma schema...`)
    let schema = `
    generator client {
      provider = "prisma-client-js"
      previewFeatures = ["fieldReference", "filteredRelationCount", "fullTextSearch"]
    }

    datasource db {
      provider     = "postgresql"
      url          = env("COMPOSEDB_POSTGRES_URL")
      relationMode = "prisma"
    }
    `
    const relations: { [key: string]: string[] } = {}
    // iterate through models to find relations
    Object.keys(definition.models).forEach((k) => {
      relations[k] = []
      // iteracte through fields to find relations
      Object.keys(definition.objects[k]).forEach((f) => {
        const fieldMeta = definition.objects[k][f]
        if (
          fieldMeta['type'] == 'view' &&
          fieldMeta['viewType'] == 'relation'
        ) {
          const foreignTable = Object.keys(definition.models).find(
            (tName) =>
              definition.models[tName].id == fieldMeta['relation'].model
          )
          if (foreignTable) {
            switch (fieldMeta['relation'].source) {
              case 'queryConnection':
                relations[k].push(
                  `${f} ${foreignTable}Stream[] @relation("${fieldMeta[
                    'relation'
                  ]['property'].toLowerCase()}")`
                )
                break
              case 'document':
                relations[k].push(
                  `${f} ${foreignTable}Stream? @relation(name: "${fieldMeta[
                    'relation'
                  ]['property'].toLowerCase()}", fields: [${
                    fieldMeta['relation']['property']
                  }], references: [stream_id], map: "${f}-${
                    fieldMeta['relation']['property']
                  }")`
                )
                relations[foreignTable].push(
                  `${k.toLowerCase()}s ${k}Stream[] @relation(name: "${fieldMeta[
                    'relation'
                  ]['property'].toLowerCase()}")`
                )
                relations[k].push(`${fieldMeta['relation']['property']} String`)
                break
              default:
                break
            }
          }
        }
      })
    })
    // one more time to put it all together
    Object.keys(definition.models).forEach((k) => {
      schema += `
      model ${k}Stream {
        stream_id String @id
        ${relations[k]?.join('\n')}
        @@map("${definition.models[k].id}")
      }
      `
    })
    const prismaSchemaFile = path.join(args.prismaFolder, 'schema.prisma')
    await writeFile(prismaSchemaFile, schema)
    log(`prisma schema generated`)
    log(`pulling prisma db config...`)
    execSync(`prisma db pull --schema ${prismaSchemaFile}`)
    log(`pulled prisma db config`)
    log('generating prisma client...')
    execSync(`prisma generate --schema ${prismaSchemaFile}`)
    log('prisma client generated')
  }
  private client = async (
    definition: RuntimeCompositeDefinition,
    args: ComposeDBArgs
  ) => {
    const clientDir = path.join(args.outDir, args.clientFolder)
    if (!existsSync(clientDir)) {
      mkdirSync(clientDir)
    }
    const templateDir = path.join(__dirname, 'templates')
    const serviceTemplate = await readFile(
      path.join(templateDir, 'service.ts.tmpl'),
      'utf-8'
    )
    for (const k of Object.keys(definition.models)) {
      const output = serviceTemplate
        .replaceAll('${MODEL_NAME}', k)
        .replaceAll(
          '${MODEL_NAME_LOWERCASE}',
          k.charAt(0).toLowerCase() + k.slice(1)
        )
      await writeFile(path.join(clientDir, `${k}.ts`), output)
    }

    // generate composedb core client file
    const indexTemplate = await readFile(
      path.join(templateDir, 'index.ts.tmpl'),
      'utf-8'
    )
    let serviceImports = ''
    let serviceProperties = ''
    let serviceConstructor = ''
    for (const k of Object.keys(definition.models)) {
      serviceImports += `import \{${k}Service\} from './${k}.js'\n`
      serviceProperties += `readonly ${
        k.charAt(0).toLowerCase() + k.slice(1)
      }: ${k}Service\n`
      serviceConstructor += `this.${
        k.charAt(0).toLowerCase() + k.slice(1)
      } = new ${k}Service(this)\n`
    }
    await writeFile(
      path.join(clientDir, `index.ts`),
      indexTemplate
        .replaceAll('${SERVICE_IMPORTS}', serviceImports)
        .replaceAll('${SERVICE_PROPERTIES}', serviceProperties)
        .replaceAll('${SERVICE_CONSTRUCTOR}', serviceConstructor)
    )
    const utilTemplate = await readFile(
      path.join(templateDir, 'utils.ts.tmpl'),
      'utf-8'
    )
    await writeFile(path.join(clientDir, `utils.ts`), utilTemplate)
  }
}
