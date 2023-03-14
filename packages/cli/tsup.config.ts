import type { Options } from 'tsup'

export const tsup: Options = {
  clean: true,
  splitting: true,
  target: 'node14',
  format: ['esm'],
  dts: true,
  bundle: true,
  entry: ['src/index.ts'],
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
    'graphql',
  ],
  outDir: 'bin',
}
