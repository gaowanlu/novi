import './config/loadDotenv.js'
import logger from './logger.js'

import express from 'express'

import { middlewareLogger } from './middlewares/middlewareLogger.js'
import { connectMongo } from './db/dbMongo.js'
import { connectPostgres } from './db/dbPostgres.js'
import { connectRedis } from './db/dbRedis.js'
import { kafka } from './mq/mqKafka.js'

import userRouter from './routes/user.js'
import orderRouter from './routes/order.js'

const app = express();
const PORT = 3000;

app.use(middlewareLogger)
app.use(express.json())

// 中间件示例
app.use((req, res, next) => {
    logger.info(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
    next()
})

// 路由
app.get('/', (req, res) => {
    res.send('Hello novi 🚀')
});

app.use('/api/user', userRouter);
app.use('/api/order', orderRouter);

async function startServer() {
    await connectMongo();
    await connectRedis();
    await connectPostgres();

    app.listen(PORT, () => {
        logger.info(`✅ Server running at http://localhost:${PORT}`)
    })
}

startServer();

