import { createClient } from "redis";
import logger from '../logger.js';

export const redisClient = createClient({
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
    },
    password: process.env.REDIS_PASSWORD || undefined
});

redisClient.on('connect', () => logger.info('✅ Redis 已连接'));
redisClient.on('error', (err) => logger.info('❌ Redis 连接错误:', err));

export async function connectRedis() {
    await redisClient.connect();
}
