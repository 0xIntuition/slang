import { RuntimeCompositeDefinition } from '@composedb/types'
import { execSync } from 'child_process'
import { writeFile } from 'fs/promises'
import path from 'path'
import { GenerateOptions } from './index.js'

export async function prisma(
  definition: RuntimeCompositeDefinition,
  options: GenerateOptions,
  log: (s: string) => void
) {
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
                `${f} ${foreignTable}Stream[] @relation("${fieldMeta[
                  'relation'
                ]['property'].toLowerCase()}")`
              )
              break
            case 'document':
              relations[k].push(
                `${f} ${foreignTable}Stream? @relation(name: "${fieldMeta[
                  'relation'
                ]['property'].toLowerCase()}", fields: [custom_${
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
              relations[k].push(
                `custom_${fieldMeta['relation']['property']} String`
              )
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
  const prismaSchemaFile = path.join(process.cwd(), 'schema.prisma')
  await writeFile(prismaSchemaFile, schema)
  log(`prisma schema generated`)
  log(`pulling prisma db config...`)
  execSync(`prisma db pull --schema ${prismaSchemaFile}`)
  log(`pulled prisma db config`)
  log('generating prisma client...')
  execSync(`prisma generate --schema ${prismaSchemaFile}`)
  log('prisma client generated')
}
