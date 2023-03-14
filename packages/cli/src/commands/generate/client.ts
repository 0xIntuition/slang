import { RuntimeCompositeDefinition } from '@composedb/types'
import { existsSync, mkdirSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
import { GenerateOptions } from './index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export async function client(
  definition: RuntimeCompositeDefinition,
  options: GenerateOptions
) {
  const clientDir = path.join(options.outputDir, 'client')
  if (!existsSync(clientDir)) {
    mkdirSync(clientDir)
  }
  const templateDir = path.join(__dirname, '../../templates/generate')
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
