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
    logger.info('❌ Redis 连接错误:', err);
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
