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

      const swContent = fs.readFileSync(swPath, 'utf8');
      fs.writeFileSync(swPath, swContent.replace('/* __VITE_ASSETS__ */', assetLines), 'utf8');
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
