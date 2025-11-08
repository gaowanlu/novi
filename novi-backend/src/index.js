import './config/loadDotenv.js'
import logger from './logger.js'

import express from 'express'

import { middlewareLogger } from './middlewares/middlewareLogger.js'
import { connectMongo } from './db/dbMongo.js'
import { connectPostgres } from './db/dbPostgres.js'
import { connectRedis } from './db/dbRedis.js'

import userRouter from './routes/user.js'
import orderRouter from './routes/order.js'
import authRouter from './routes/auth.js'
import friendRouter from './routes/friend.js';
import messageRouter from './routes/message.js';

import http from 'http'
import { userConnections } from './connections/userConnections.js'
import { noviNodeIPC } from './mq/noviNodeIPC.js'

const PORT = process.env.NOVI_PORT;
const HOST = process.env.NOVI_HOST;

const app = express();
const httpServer = http.createServer(app);
// /api/ws
userConnections.init(httpServer);

app.use(middlewareLogger)
app.use(express.json())
app.use((req, res, next) => {
    logger.info(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
    next()
})
app.get('/', (req, res) => {
    res.send('Hello novi 🚀')
});
app.use('/api/user', userRouter);
app.use('/api/order', orderRouter);
app.use('/api/auth', authRouter);
app.use('/api/friend', friendRouter);
app.use('/api/message', messageRouter);

async function startServer() {
    await connectMongo();
    await connectRedis();
    await connectPostgres();

    noviNodeIPC.init();

    httpServer.listen(PORT, HOST, () => {
        logger.info(`✅ Server running at http://${HOST}:${PORT}`);
    })
}

startServer();
