import type { Options } from 'tsup'

export const tsup: Options = {
  clean: true,
  dts: true,
  splitting: true,
  sourcemap: true,
  platform: 'node',
  format: ['esm'],
  outDir: 'dist',
  target: 'esnext',
  entry: ['src/index.ts'],
  noExternal: [
    '@didtools/cacao',
    'did-session',
    'uint8arrays',
    '@composedb/client',
  ],
  // onSuccess: 'cp package.json dist/package.json',
}
