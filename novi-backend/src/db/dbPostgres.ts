import pkg from 'pg'
import type { Pool, QueryResult } from 'pg'
import logger from '../logger.js';

const { Pool: PgPool } = pkg;

// 订单记录接口
interface Order {
    id: number,
    user_id: number,
    amount: number,
    created_at: Date
}

// 创建 PostgreSQL 连接池
const pgPool: Pool = new PgPool({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASSWORD,
    port: parseInt(process.env.PG_PORT as string)
});

// 监听连接事件
pgPool.on('connect', (): void => {
    logger.info('PostgreSQL 已连接');
});

// 监听错误事件
pgPool.on('error', (err: Error): void => {
    logger.error('PostgreSQL 池错误：', err.message);
});

// 初始化数据库表结构
// 创建orders表（如果不存在）
const updateDatabaseNovi = async (): Promise<void> => {
    try {
        const sql: string = `
CREATE TABLE IF NOT EXISTS orders(
id SERIAL PRIMARY KEY,           -- 自增主键
user_id INT NOT NULL,            -- 用户ID
amount INT NOT NULL,             -- 金额，单位为分
created_at TIMESTAMP NOT NULL DEFAULT NOW()  -- 创建时间，默认当前时间
);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
`;
        await pgPool.query(sql);
        logger.info('orders 表已创建或已存在');
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '未知错误'
        logger.error(`创建 orders 表失败: ${errorMessage}`)
        throw err
    }
};

// 连接 PostgreSQL 数据库
// 仅做连接探测 + 建表，不手动借出 client（借出而不 release 会泄漏连接）
const connectPostgres = async (): Promise<void> => {
    try {
        await pgPool.query('SELECT 1');
        await updateDatabaseNovi();
        logger.info("Postgres connected");
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '未知错误'
        logger.error(`PostgreSQL 连接失败: ${errorMessage}`)
        throw err
    }
};

export { pgPool, connectPostgres };
export type { Order };
