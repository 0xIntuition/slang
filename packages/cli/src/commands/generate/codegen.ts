import { RuntimeCompositeDefinition } from '@composedb/types'
import * as addPlugin from '@graphql-codegen/add'
import { CodegenConfig, generate } from '@graphql-codegen/cli'
import { CodegenPlugin } from '@graphql-codegen/plugin-helpers'
import * as typescriptPlugin from '@graphql-codegen/typescript'
import * as typescriptOperationsPlugin from '@graphql-codegen/typescript-operations'
import { writeFile } from 'fs/promises'
import * as typescriptValidationPlugin from 'graphql-codegen-typescript-validation-schema'
import path from 'path'
import { GenerateOptions } from './index.js'

export async function codegen(
  definition: RuntimeCompositeDefinition,
  options: GenerateOptions,
  log: (s: string) => void
) {
  log(`generating graphql mutations...`)
  let queryContent = `
  import { gql } from 'graphql-tag'
  `
  for (const m of Object.keys(definition.models)) {
    log(` - forming mutations for model ${m}`)
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
  const mutationFile = path.join(options.outputDir, 'mutations.ts')
  await writeFile(mutationFile, queryContent)
  log(`wrote mutations to ${mutationFile}`)
  log(`running graphql codegen...`)
  const config: CodegenConfig = {
    schema: path.join(options.outputDir, 'schema.graphql'),
    documents: [options.outputDir],
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
      [path.join(options.outputDir, 'types.ts')]: {
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
      [path.join(options.outputDir, 'validation.ts')]: {
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
      [path.join(options.outputDir, 'index.ts')]: {
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
  log(`graphql codegen complete`)
}
