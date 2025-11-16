import './config/loadDotEnv.js'
import logger from './logger.js'
import cors from 'cors'
import express from 'express'
import type { Response, NextFunction } from 'express'
import type { IRequest } from './comm/request.js'

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
import path from 'path'

const PORT: number = parseInt(process.env.NOVI_PORT ?? '3000', 10)
const HOST: string | undefined = process.env.NOVI_HOST ?? '0.0.0.0'
const EXPRESS_STATIC_PATH: string = process.env.EXPRESS_STATIC_PATH ?? ''

const app = express();
const httpServer = http.createServer(app);
// /api/ws
userConnections.init(httpServer);

app.use(middlewareLogger)

// 允许所有来源（开发时最宽松）
app.use(cors());
// 如果你想更严格一点，只允许特定域名（生产推荐）
// app.use(cors({
//   origin: ['http://localhost:3000', 'https://yourdomain.com'],
//   credentials: true,  // 如果前端要带 cookie
// }));

// 静态资源目录
if (EXPRESS_STATIC_PATH) {
    app.use(express.static(EXPRESS_STATIC_PATH));
}

app.use(express.json())
app.use((req: IRequest, res: Response, next: NextFunction) => {
    logger.info(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
    next()
})
app.get('/', (req: IRequest, res: Response) => {
    res.send('Hello novi 🚀')
});
app.use('/api/user', userRouter);
app.use('/api/order', orderRouter);
app.use('/api/auth', authRouter);
app.use('/api/friend', friendRouter);
app.use('/api/message', messageRouter);

if (EXPRESS_STATIC_PATH) {
    app.get(/.*/, (req: IRequest, res: Response) => {
        res.sendFile(path.join(EXPRESS_STATIC_PATH, "index.html"));
    });
}

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
