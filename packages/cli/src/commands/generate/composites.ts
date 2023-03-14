import { CeramicClient } from '@ceramicnetwork/http-client'
import { Composite } from '@composedb/devtools'
import { writeEncodedComposite } from '@composedb/devtools-node'
import { readFile } from 'fs/promises'
import { parse, visit } from 'graphql'
import path from 'path'
import { GenerateOptions } from './index.js'

export async function parseGraphqlModels(
  ceramic: CeramicClient,
  filenames: string[],
  options: GenerateOptions,
  log: (s: string) => void
): Promise<{ paths: string[] }> {
  const embeds: string[] = []
  let composites: { [key: string]: Composite } = {}
  const paths: string[] = []
  for (const fileName of filenames) {
    log(`parsing ${fileName}...`)
    let content = await readFile(fileName, 'utf-8')
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
        log(`filling reference to model ${k} in ${fileName}`)
        content = content.replaceAll(
          '${' + k + '}',
          composites[k].toRuntime().models[k].id
        )
      }
    }
    // generate the composite
    for (const name of names) {
      const { composite, compositePath } = await createAndWriteComposite(
        ceramic,
        name,
        embeds.join('\n') + '\n' + content, // include embeds with everything to be safe
        options,
        (s) => log(`  - ${s}`)
      )
      composites[name] = composite
      paths.push(compositePath)
    }
  }
  return { paths }
}

export async function createAndWriteComposite(
  ceramic: CeramicClient,
  name: string,
  content: string,
  options: GenerateOptions,
  log: (s: string) => void
) {
  log(`${name}: generating composite...`)
  // create the composite
  let composite = await Composite.create({
    ceramic,
    schema: content,
    index: !options.dryRun,
  })
  // set human-readable alias
  composite = composite.setAliases({
    [name]: composite.toRuntime().models[name].id,
  })
  // form the output path
  const compositePath = path.join(
    options.outputDir,
    'composites',
    `${name}.json`
  )
  // write the composite
  await writeEncodedComposite(composite, compositePath)
  log(`${name}: wrote composite to ${compositePath}`)
  return { composite, compositePath }
}
