import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

function injectSwAssetsPlugin(): Plugin {
  return {
    name: 'inject-sw-assets',
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      const assetsDir = path.join(distDir, 'assets');
      const swPath = path.join(distDir, 'sw.js');
      if (!fs.existsSync(swPath) || !fs.existsSync(assetsDir)) return;

      const assetLines = fs
        .readdirSync(assetsDir)
        .filter((f) => /\.(js|css)$/.test(f))
        .map((f) => `  './assets/${f}',`)
        .join('\n');

      const pkgPath = path.resolve(__dirname, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
      const cacheVersion = `${pkg.version ?? '0.0.0'}-${Date.now().toString(36)}`;

      const swContent = fs
        .readFileSync(swPath, 'utf8')
        .replace('__CACHE_VERSION__', cacheVersion)
        .replace('/* __VITE_ASSETS__ */', assetLines);
      fs.writeFileSync(swPath, swContent, 'utf8');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [injectSwAssetsPlugin()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
  server: {
    host: true,
    port: 5173,
  },
});
