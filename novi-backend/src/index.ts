import './config/loadDotEnv.js'
import logger from './logger.js'
import cors from 'cors'
import express from 'express'
import type { Response, NextFunction } from 'express'
import type { IRequest } from './comm/request.js'

import { middlewareLogger } from './middlewares/middlewareLogger.js'
import { connectMongo, disconnectMongo } from './db/dbMongo.js'
import { connectPostgres } from './db/dbPostgres.js'
import { connectRedis, disconnectRedis } from './db/dbRedis.js'
import { pgPool } from './db/dbPostgres.js'

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
    // Redis 必须先于 Mongo：onMongoConnected 的启动互斥锁（SET NX）依赖 Redis 就绪，
    // 否则 node-redis 对未连接客户端抛 ClientClosedError（"The client is closed"）拖死整个启动。
    await connectRedis();
    await connectMongo();
    await connectPostgres();

    noviNodeIPC.init();

    setupGracefulShutdown(httpServer);

    httpServer.listen(PORT, HOST, () => {
        logger.info(`✅ Server running at http://${HOST}:${PORT}`);
    })
}

/**
 * 优雅关闭：收到 SIGTERM/SIGINT 时按序释放各长连接（HTTP → Socket.IO → Mongo → Redis → Postgres）。
 * 任一失败不阻断后续释放；超时（10s）仍未完成则强制退出，避免挂死。
 */
function setupGracefulShutdown(httpServer: http.Server): void {
    let shuttingDown = false;

    const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) return; // 防止重复触发
        shuttingDown = true;
        logger.info(`收到 ${signal}，开始优雅关闭…`);

        // 强制退出兜底：10s 后仍未完成则直接退出
        const forceExit = setTimeout(() => {
            logger.error('优雅关闭超时（10s），强制退出');
            process.exit(1);
        }, 10_000);
        forceExit.unref?.();

        try {
            // 1) 停止接受新 HTTP 连接，等待在途请求结束
            httpServer.close(() => logger.info('HTTP 服务已停止'));
            // 2) 关闭 Socket.IO（踢掉所有在线 socket，触发 onDisconnect 清理 redis 在线态）
            userConnections.socketIOServer?.close?.();
            // 3) 各数据库连接
            await Promise.allSettled([
                disconnectMongo().catch((e) => logger.error(`Mongo 断开失败: ${e.message}`)),
                disconnectRedis().catch((e) => logger.error(`Redis 断开失败: ${e.message}`)),
                pgPool.end().catch((e: Error) => logger.error(`Postgres 断开失败: ${e.message}`)),
            ]);
            logger.info('✅ 所有连接已释放，进程退出');
            process.exit(0);
        } catch (err) {
            const e = err as Error;
            logger.error(`优雅关闭异常: ${e.message}`);
            process.exit(1);
        }
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
}

startServer().catch((err) => {
    logger.error(`启动失败: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
