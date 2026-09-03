import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// 本地演示/联调：把 /api 代理到独立的 mock 服务（见仓库根 mock/），
// 这样前端无需改动、也无需真实后端（Mongo/Redis/RabbitMQ/Kafka）即可完整跑起来。
// 代理目标可用环境变量 NOVI_MOCK_PORT 覆盖，默认 3300。
const MOCK_TARGET = process.env.NOVI_MOCK_TARGET ?? 'http://127.0.0.1:3300'

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
        target: MOCK_TARGET,
        changeOrigin: true,
      },
    },
  },
})
