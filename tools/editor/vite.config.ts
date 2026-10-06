import { defineConfig } from 'vite';

// 数据工坊前端：Tauri dev 由 beforeDevCommand 拉起本服务（端口固定 1420，见 tauri.conf.json）。
// server.fs.allow 放开仓库根，因为校验/导出直接 import tools/ 下的纯核心（validate-core / dump-core），
// 不复制、不再实现（design §6.1 分工原则）。
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    fs: { allow: ['../..'] },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
