import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  splitting: false,
  clean: true,
  dts: false,
  sourcemap: true,
  outDir: 'dist',
  banner: {
    js: `import { createRequire } from 'module';const require = createRequire(import.meta.url);`
  }
});
