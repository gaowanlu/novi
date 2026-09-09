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
})
