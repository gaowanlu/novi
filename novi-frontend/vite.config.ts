import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// 本地开发：把 /api 代理到真实后端，避免跨域。
// 代理目标可用环境变量 NOVI_BACKEND_TARGET 覆盖，默认 http://127.0.0.1:3000（本地后端端口）。
const BACKEND_TARGET = process.env.NOVI_BACKEND_TARGET ?? 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: BACKEND_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    // 大型三方库单独分包，让各路由的懒加载 chunk 可被浏览器缓存复用，
    // 避免全部打进主包（此前单包 622kB）。
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('framer-motion')) return 'motion'
            if (id.includes('socket.io-client')) return 'socket'
            if (id.includes('react-dom') || id.includes('react-router') || id.includes('/react/')) return 'react'
            if (id.includes('@radix-ui') || id.includes('radix-ui')) return 'radix'
            return 'vendor'
          }
        },
      },
    },
  },
})
