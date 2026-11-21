import { defineConfig } from 'vite';

/**
 * GitHub Pages 项目站点部署在 /<repo>/ 路径下，因此构建时默认使用 /ai/ 作为基路径。
 * 可通过 BASE_PATH 环境变量覆盖（例如使用自定义域名时设为 /）。
 */
export default defineConfig(({ command }) => ({
  base: process.env.BASE_PATH || (command === 'build' ? '/ai/' : '/'),
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
  },
}));
