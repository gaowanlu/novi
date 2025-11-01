import express from 'express'
import userRouter from './routes/user.js'
import { logger } from './middlewares/logger.js'

const app = express()
const PORT = 3000

app.use(logger)
app.use(express.json())

// 中间件示例
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
    next()
})

// 路由
app.get('/', (req, res) => {
    res.send('Hello Express (JavaScript版) 🚀')
})

app.use('/user', userRouter)

app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`)
})
