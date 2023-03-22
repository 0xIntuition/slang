import { CeramicClient } from '@ceramicnetwork/http-client'
import { Composite } from '@composedb/devtools'
import {
  mergeEncodedComposites,
  readEncodedComposite,
  writeEncodedComposite,
  writeEncodedCompositeRuntime,
} from '@composedb/devtools-node'
import * as addPlugin from '@graphql-codegen/add'
import { CodegenConfig, generate } from '@graphql-codegen/cli'
import { CodegenPlugin } from '@graphql-codegen/plugin-helpers'
import * as typescriptPlugin from '@graphql-codegen/typescript'
import * as typescriptOperationsPlugin from '@graphql-codegen/typescript-operations'
import { Args, Command, Flags } from '@oclif/core'
import { execSync } from 'child_process'
import { detect } from 'detect-package-manager'
import { DID } from 'dids'
import * as dotenv from 'dotenv'
import * as ejs from 'ejs'
import { existsSync, mkdirSync } from 'fs'
import { readdir, writeFile } from 'fs/promises'
import { readFile } from 'fs/promises'
import { parse, visit } from 'graphql'
import * as typescriptValidationPlugin from 'graphql-codegen-typescript-validation-schema'
import { Ed25519Provider } from 'key-did-provider-ed25519'
import { getResolver } from 'key-did-resolver'
import * as path from 'path'
import { fromString } from 'uint8arrays/from-string'

dotenv.config()

export default class Generate extends Command {
  static summary =
    'Generate ComposeDB composites, types, and client from GraphQL schema definitions'

  static flags = {
    /**
     *  REQUIRED
     */
    api: Flags.string({
      required: true,
      char: 'a',
      aliases: ['host'],
      summary: 'ComposeDB/Ceramic API URL [env: COMPOSEDB_API_URL] ',
      env: 'COMPOSEDB_API_URL',
      helpGroup: 'Required',
    }),
    db: Flags.string({
      required: true,
      char: 'd',
      aliases: ['database'],
      summary: 'ComposeDB database connection string [env: COMPOSEDB_DB_URL] ',
      description: 'Must be defined via the environment variable COMPOSEDB_DB_URL',
      env: 'COMPOSEDB_DB_URL',
      helpGroup: 'Required',
    }),
    pk: Flags.string({
      required: true,
      char: 'p',
      aliases: ['private-key'],
      summary: 'ComposeDB admin private key [env: COMPOSEDB_PRIVATE_KEY] ',
      env: 'COMPOSEDB_PRIVATE_KEY',
      helpGroup: 'Required',
    }),
    /**
     *  OPTIONAL
     */
    schemaDir: Flags.string({
      summary: 'Path to directory containing model schema files',
      char: 's',
      aliases: ['schemas'],
      default: 'schemas/',
      helpGroup: 'Optional',
    }),
    outputDir: Flags.string({
      summary: 'Path to top-level directory for generated files',
      char: 'o',
      aliases: ['output'],
      default: '__generated__/composedb/',
      helpGroup: 'Optional',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Generate)

    // prepare directories
    const schemaDir = path.join(process.cwd(), flags.schemaDir)
    if (!existsSync(schemaDir)) this.error(`Schema directory ${schemaDir} does not exist`)

    const outputDir = path.join(process.cwd(), flags.outputDir)
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })

    const compositeDir = path.join(outputDir, 'composites')
    if (!existsSync(compositeDir)) mkdirSync(compositeDir, { recursive: true })

    const prismaSchemaPath = path.join(process.cwd(), 'schema.prisma')

    const clientDir = path.join(outputDir, 'client')
    if (!existsSync(clientDir)) mkdirSync(clientDir, { recursive: true })

    // detect the package manager
    const pm = await detect({ cwd: process.cwd() })
    let pmExecutor = ''
    switch (pm) {
      case 'npm':
        pmExecutor = 'npx'
        break
      case 'yarn':
        pmExecutor = 'yarn'
        break
      case 'pnpm':
        pmExecutor = 'pnpx'
        break
      default:
        this.error('Unrecognized package manager')
    }

    // create the ceramic client
    this.log(`Connecting to Ceramic at ${flags.api}`)
    const ceramic = new CeramicClient(flags.api)

    // authenticate the ceramic client
    const key = fromString(flags.pk, 'base16')
    const did = new DID({
      resolver: getResolver(),
      provider: new Ed25519Provider(key),
    })
    await did.authenticate()
    ceramic.did = did

    /**
     *  COMPOSITES
     */

    this.log(`Reading schemas from ${flags.schemaDir}...`)

    // collect schema filepaths
    const schemaPaths = (await readdir(schemaDir))
      .filter((f) => f.endsWith('.graphql'))
      .map((f) => path.join(schemaDir, f))

    this.log(`Found ${schemaPaths.length} schema files`)

    /**
     * For each schema:
     *  1. Parse the graphql and track the models as well as any embeds
     *  2. Replace any templates with the correct model id
     *  3. Create the composite and write to disk
     */
    const embeds: string[] = []
    let composites: { [key: string]: Composite } = {}
    const compositePaths: string[] = []
    for (const schemaPath of schemaPaths) {
      this.log(` - parsing ${schemaPath.split('/').slice(-1)}...`)
      let content = await readFile(schemaPath, 'utf-8')
      const gql = parse(content)
      let names: string[] = []
      // traverse nodes to find shared objects
      visit(gql, {
        ObjectTypeDefinition: {
          enter: (node) => {
            // pick root objects with no directives
            if (!node.directives?.map((d) => d.name.value).length && node.loc?.source.body)
              embeds.push(node.loc.source.body.slice(node.loc.start, node.loc.end))
            // record the names of all models to be created
            if (node.directives?.map((d) => d.name.value)[0] == 'createModel') {
              names.push(node.name.value)
            }
          },
        },
      })
      // replace any dependent objects with the correct modelId
      const matches = content.match(/\${\S*}/gm) // ${<modelname>}
      if (matches) {
        for (const k of Object.keys(composites)) {
          if (!(k in composites))
            throw new Error(`error: ${schemaPath} references model ${k} before it's been deployed`)
          content = content.replaceAll('${' + k + '}', composites[k].toRuntime().models[k].id)
        }
      }
      // generate the composite
      for (const name of names) {
        const composite = await Composite.create({
          ceramic,
          // include embeds with everything to be extra safe
          schema: embeds.join('\n') + '\n' + content,
          index: true,
        })
        const compositePath = path.join(compositeDir, `${name}.json`)
        await writeEncodedComposite(composite, compositePath)
        this.log(`   wrote composite to ${compositePath.split('/').slice(-2).join('/')}`)
        composites[name] = composite
        compositePaths.push(compositePath)
      }
    }

    // merge composites to a single definition
    this.log('Merging composites...')
    await mergeEncodedComposites(ceramic, compositePaths, path.join(compositeDir, 'index.json'))

    // write composite runtime definition and graphql schema
    this.log('Generating runtime composite definition and GraphQL schema...')
    await writeEncodedCompositeRuntime(
      ceramic,
      path.join(compositeDir, 'index.json'),
      path.join(compositeDir, 'index.ts'),
      path.join(outputDir, 'schema.graphql')
    )

    // deploy composites
    this.log('Deploying composites...')
    const deploy = await readEncodedComposite(ceramic, path.join(compositeDir, 'index.json'), true)

    // begin indexing
    this.log('Beginning indexing...')
    await deploy.startIndexingOn(ceramic)

    /**
     *  CODEGEN
     */

    // load the freshly-generated definition
    const definition = (
      await readEncodedComposite(ceramic, path.join(compositeDir, 'index.json'), true)
    ).toRuntime()

    // generate mutation code
    this.log(`Generating GraphQL Mutations...`)
    let queryContent = `
import { gql } from 'graphql-tag'
    `
    for (const m of Object.keys(definition.models)) {
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
    const mutationFile = path.join(outputDir, 'mutations.ts')
    await writeFile(mutationFile, queryContent)

    // run graphql codegen
    this.log(`Running GraphQL codegen...`)
    const config: CodegenConfig = {
      schema: path.join(outputDir, 'schema.graphql'),
      documents: [outputDir],
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
        [path.join(outputDir, 'types.ts')]: {
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
        [path.join(outputDir, 'validation.ts')]: {
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
        [path.join(outputDir, 'index.ts')]: {
          plugins: [
            {
              add: {
                content: `
export * from './${path.join('composites/', 'index.js')}'
export * from './${path.join('types.js')}'
export * from './${path.join('validation.js')}'
export * from './${path.join('mutations.js')}'
export * from './${path.join('client', 'index.js')}'
              `,
              },
            },
          ],
        },
      },
    }
    await generate(config, true)

    /**
     *  PRISMA
     */
    // generate the prisma schema
    this.log(`Generating Prisma Schema...`)
    let dbProvider = ''
    let connectionString = ''
    switch (flags.db.split(':')[0]) {
      case 'postgres':
        dbProvider = 'postgres'
        connectionString = flags.db
        break
      case 'sqlite':
        dbProvider = 'sqlite'
        connectionString = 'file:/' + flags.db.split('///')[1]
        break
      default:
        this.error(`Unrecognized database provider ${flags.db.split(':')[0]}`)
    }
    let prismaSchema = `
generator client {
  provider = "prisma-client-js"
  previewFeatures = ["fieldReference", "filteredRelationCount", "fullTextSearch"]
}

datasource db {
  provider     = "${dbProvider}"
  url          = ${
    dbProvider == 'sqlite' ? '"' + connectionString + '"' : 'env("COMPOSEDB_DB_URL")'
  }
  relationMode = "prisma"
}
  `
    const relations: { [key: string]: string[] } = {}
    // iterate through models to find relations
    Object.keys(definition.models).forEach((k) => {
      relations[k] = []
      // iterate through fields to find relations
      Object.keys(definition.objects[k]).forEach((f) => {
        const fieldMeta = definition.objects[k][f]
        if (fieldMeta['type'] == 'view' && fieldMeta['viewType'] == 'relation') {
          const foreignTable = Object.keys(definition.models).find(
            (tName) => definition.models[tName].id == fieldMeta['relation'].model
          )
          if (foreignTable) {
            switch (fieldMeta['relation'].source) {
              case 'queryConnection':
                relations[k].push(
                  `${f} ${foreignTable}Stream[] @relation("${fieldMeta['relation'][
                    'property'
                  ].toLowerCase()}")`
                )
                break
              case 'document':
                relations[k].push(
                  `${f} ${foreignTable}Stream? @relation(name: "${fieldMeta['relation'][
                    'property'
                  ].toLowerCase()}", fields: [custom_${
                    fieldMeta['relation']['property']
                  }], references: [stream_id], map: "${f}-${fieldMeta['relation']['property']}")`
                )
                relations[foreignTable].push(
                  `${k.toLowerCase()}s ${k}Stream[] @relation(name: "${fieldMeta['relation'][
                    'property'
                  ].toLowerCase()}")`
                )
                relations[k].push(`custom_${fieldMeta['relation']['property']} String`)
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
      prismaSchema += `
    model ${k}Stream {
      stream_id String @id
      ${dbProvider != 'sqlite' ? relations[k]?.join('\n') : ``}
      @@map("${definition.models[k].id}")
    }
    `
    })
    // write the prisma schema
    await writeFile(prismaSchemaPath, prismaSchema)

    // pull the db config to get the rest of the schema
    this.log('Wrote skeleton prisma.schema')
    this.log('Pulling prisma db config...')
    execSync(`${pmExecutor} prisma db pull --schema ${prismaSchemaPath}`)

    // if sqlite, replace Int with BIGINT
    if (dbProvider == 'sqlite') {
      const contents = await readFile(prismaSchemaPath, 'utf-8')
      let newContents = contents.replaceAll('Int', 'BigInt')
      await writeFile(prismaSchemaPath, newContents)
    }

    // generate the prisma client
    this.log('Generating prisma client...')
    execSync(`${pmExecutor} prisma generate --schema ${prismaSchemaPath}`)

    /**
     *  CLIENT
     */
    this.log('Generating client...')

    // render and write the service templates
    for (const k of Object.keys(definition.models)) {
      const output = ejs.render(serviceTemplate, {
        modelName: k,
        modelNameLowercase: k.charAt(0).toLowerCase() + k.slice(1),
      })
      await writeFile(path.join(clientDir, `${k}.ts`), output)
    }

    // render and write the core client file
    let serviceImports = ''
    let serviceProperties = ''
    let serviceConstructors = ''
    for (const k of Object.keys(definition.models)) {
      serviceImports += `import \{${k}Service\} from './${k}.js'\n`
      serviceProperties += `readonly ${k.charAt(0).toLowerCase() + k.slice(1)}: ${k}Service\n`
      serviceConstructors += `this.${
        k.charAt(0).toLowerCase() + k.slice(1)
      } = new ${k}Service(this)\n`
    }
    await writeFile(
      path.join(clientDir, `index.ts`),
      ejs.render(clientTemplate, { serviceImports, serviceProperties, serviceConstructors }, {})
    )

    // render and write the util file
    await writeFile(path.join(clientDir, 'utils.ts'), utilsTemplate)

    // install dependencies
    this.log('Installing dependencies...')
    execSync(`${pm} add ${dependencies}`)
    this.log('Installing devDependencies...')
    execSync(`${pm} add -D ${devDependencies}`)

    this.log(`Complete.`)
  }
}

const clientTemplate = `
import { LoadOpts } from '@ceramicnetwork/common'
import { CeramicClient } from '@ceramicnetwork/http-client'
import { StreamID } from '@ceramicnetwork/streamid'
import { ComposeClient } from '@composedb/client'
import { ModelInstanceDocument } from '@composedb/types'
import { Prisma, PrismaClient } from '@prisma/client'
import { DID } from 'dids'
import { DocumentNode } from 'graphql'
import { AnyZodObject } from 'zod'
import { definition } from '../composites/index.js'
import { Expand, removeNullFields } from './utils.js'
<%- serviceImports %>

export interface Stream {
  stream_id: string
  controller_did: string
  stream_content: Prisma.JsonValue
  tip: string
  last_anchored_at: Date | null
  first_anchored_at: Date | null
  created_at: Date
  updated_at: Date
}
export type ContentStream<TStream, TContent> = Expand<
  Omit<TStream, 'stream_content'> & {
    stream_content: TContent
  }
>

export interface Result<T> {
  data?: T
  errors?: Error[]
}

export interface ClientParams {
  ceramicURL: string
  did?: DID
  prisma?: PrismaClient
}

export class Client {
  readonly prisma: PrismaClient
  readonly ceramic: CeramicClient
  readonly composedb: ComposeClient

  <%= serviceProperties %>

  private _did = new DID()
  private _errors: Error[] = []

  constructor(params: Expand<ClientParams>) {
    this.prisma = params.prisma || new PrismaClient()
    this.ceramic = new CeramicClient(params.ceramicURL)
    this.composedb = new ComposeClient({
      ceramic: this.ceramic,
      definition: definition,
    })
    this.did = params.did || new DID()

    <%= serviceConstructors %>
  }

  get did() {
    return this._did
  }

  set did(did: DID) {
    this._did = did
    this.ceramic.did = did
    this.composedb.setDID(did)
  }

  isConnected(): boolean {
    return (
      !!this.ceramic.did &&
      !!this.composedb.did &&
      this._did.authenticated &&
      this._did.hasCapability
    )
  }

  disconnect() {
    this.did = new DID()
  }

  errors(): Error[] {
    const errors = this._errors
    this._errors = []
    return errors
  }

  async composeQuery<TQuery>(
    document: DocumentNode,
    vars?: Record<string, unknown>
  ): Promise<TQuery> {
    const result = await this.composedb.execute<TQuery>(document, vars)
    if (result.errors) {
      console.error(result.errors)
      throw new Error(result.errors.join(','))
    }
    return result.data as TQuery
  }

  async composeMutation<TInput, TMutation>(
    document: DocumentNode,
    input: TInput,
    schema: AnyZodObject
  ): Promise<TMutation> {
    const parsed = schema.safeParse(input)
    if (parsed.success) {
      input = parsed.data as TInput
    } else {
      console.error(parsed.error)
      throw parsed.error
    }
    input = removeNullFields(input)
    const result = await this.composedb.execute<TMutation>(document, {
      input,
    })
    if (result.errors) {
      console.error(result.errors)
      throw new Error(result.errors.join(','))
    }
    return result.data as TMutation
  }

  async loadStream<TContent>(
    id?: string,
    opts?: LoadOpts
  ): Promise<ModelInstanceDocument<TContent>> {
    if (!id) throw new Error('id cannot be null')
    try {
      const result = await this.ceramic.loadStream<
        ModelInstanceDocument<TContent>
      >(StreamID.fromString(id), opts)
      return result
    } catch (e) {
      console.error(e)
      throw e
    }
  }
}
`

const serviceTemplate = `
import type { <%= modelName %>Stream } from '@prisma/client'
import { Client } from './index.js'
import {
  Create<%= modelName %>Input,
  Create<%= modelName %>Mutation,
  Update<%= modelName %>Input,
  Update<%= modelName %>Mutation,
  <%= modelName %>Input,
} from '../types.js'
import {
  Create<%= modelName %>InputSchema,
  Update<%= modelName %>InputSchema,
  <%= modelName %>InputSchema,
} from '../validation.js'
import {
  Create<%= modelName %>Document,
  Update<%= modelName %>Document,
} from '../mutations.js'
import { Expand } from './utils.js'

export type Parsed<%= modelName %>Stream<T extends <%= modelName %>Stream> = T & {
  data: <%= modelName %>Input
}

export class <%= modelName %>Service {
  private _client: Client

  constructor(client: Client) {
    this._client = client
  }

  parse<T extends <%= modelName %>Stream>(
    <%= modelNameLowercase %>Stream: T
  ): Parsed<%= modelName %>Stream<T> {
    return {
      ...<%= modelNameLowercase %>Stream,
      data: <%= modelName %>InputSchema().parse(<%= modelNameLowercase %>Stream.stream_content),
    }
  }

  async create(
    input: Expand<Create<%= modelName %>Input>
  ): Promise<Create<%= modelName %>Mutation> {
    return await this._client.composeMutation<
      Create<%= modelName %>Input,
      Create<%= modelName %>Mutation
    >(Create<%= modelName %>Document, input, Create<%= modelName %>InputSchema())
  }

  async update(
    input: Expand<Update<%= modelName %>Input>
  ): Promise<Update<%= modelName %>Mutation> {
    return await this._client.composeMutation<
      Update<%= modelName %>Input,
      Update<%= modelName %>Mutation
    >(Update<%= modelName %>Document, input, Update<%= modelName %>InputSchema())
  }
}
`

const utilsTemplate = `
export function removeNullFields(input: any): any {
  if (typeof input === 'object' && !(input instanceof Date) && input !== null) {
    if (input instanceof Array) {
      return input
        .map(removeNullFields)
        .filter((item) => item !== null && item !== undefined)
    }

    return Object.fromEntries(
      Object.entries(input)
        .map(([key, val]) => [key, removeNullFields(val)])
        .filter(([k, v]) => v !== null && v !== undefined)
    )
  }

  return input
}

// expands object types one level deep
export type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never

// expands object types recursively
export type ExpandRecursively<T> = T extends object
  ? T extends infer O
    ? { [K in keyof O]: ExpandRecursively<O[K]> }
    : never
  : T
`

const dependencies = ` \
  @ceramicnetwork/common@^2.23.0 \
  @ceramicnetwork/http-client@^2.20.0 \
  @ceramicnetwork/streamid@^2.14.0 \
  @composedb/client@^0.4.3 \
  @prisma/client \
  dids@^4.0.0 \
  graphql@^16.6.0 \
  graphql-tag@^2.12.6 \
  zod@^3.20.6
`

const devDependencies = ` \
  @composedb/types@^0.4.3
`
