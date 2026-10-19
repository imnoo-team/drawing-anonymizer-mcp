import { defineConfig } from 'tsup';
export default defineConfig({
    entry: { index: 'src/index.ts' },
    format: 'esm',
    target: 'node22',
    platform: 'node',
    outDir: 'dist',
    clean: true,
    dts: false,
    sourcemap: false,
    minify: false,
    banner: { js: '#!/usr/bin/env node' },
    loader: { '.ttf': 'binary' },
});
