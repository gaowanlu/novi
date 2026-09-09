import { createClient } from "redis";
import type { RedisClientType } from "redis";
import logger from '../logger.js';

// 创建 Redis 客户端
export const redisClient: RedisClientType = createClient({
    socket: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT as string),
    },
    password: process.env.REDIS_PASSWORD || undefined
});

redisClient.on('connect', (): void => {
    logger.info('✅ Redis 已连接')
});

redisClient.on('error', (err: Error): void => {
    logger.error(`❌ Redis 连接错误: ${err.message}`);
});

// 断线自动重连：redis 官方客户端默认 reconnectStrategy=指数退避，但这里显式声明并
// 限制上限，避免异常时日志刷屏。重连成功后下次命令即恢复。
redisClient.on('reconnecting', (ms: number): void => {
    logger.warn(`↻ Redis 重连中（${ms}ms 后重试）`);
});

export async function connectRedis(): Promise<void> {
    try {
        await redisClient.connect();
        logger.info('✅ Redis 连接成功');
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '未知错误';
        logger.error(`❌ Redis 连接失败: ${errorMessage}`);
        throw err;
    }
}

// 优雅关闭：幂等，重复调用安全。quit 优雅退出；若尚未建立连接则直接丢弃。
export async function disconnectRedis(): Promise<void> {
    if (redisClient.isOpen) {
        await redisClient.quit();
        logger.info('Redis 已断开连接');
    } else if (!redisClient.isReady) {
        // 未就绪（连接中/已断）：直接丢弃，避免挂起
        try {
            redisClient.disconnect();
        } catch { /* 忽略 */ }
    }
}
