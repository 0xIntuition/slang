import type { Options } from 'tsup'

export const tsup: Options = {
  clean: true,
  platform: 'node',
  format: ['cjs'],
  outDir: 'bin',
  target: 'esnext',
  entry: ['src/index.ts'],
  bundle: true,

  external: ['prisma', '@prisma/client'],
  noExternal: [
    '@didtools/cacao',
    'did-session',
    'uint8arrays',
    '@composedb/client',
    '@ceramicnetwork/common',
    '@ceramicnetwork/http-client',
    '@ceramicnetwork/streamid',
    '@composedb/client',
    '@composedb/types',
  ],
  onSuccess: 'cp -r src/templates bin/templates',
}
