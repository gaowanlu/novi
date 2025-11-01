import pkg from 'pg'
import logger from '../logger.js';

const { Pool } = pkg;

const pgPool = new Pool({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT
});

pgPool.on('connect', () => {
    logger.info('PostgreSQL 已连接');
});

let updateDatabaseNovi = async () => {
    try {
        await pgPool.query(`
CREATE TABLE IF NOT EXISTS orders(
    id SERIAL PRIMARY KEY,           -- 自增主键
    user_id INT NOT NULL,            -- 用户ID
    amount INT NOT NULL,             -- 金额，单位为分
    created_at TIMESTAMP NOT NULL DEFAULT NOW()  -- 创建时间，默认当前时间
);`);
        logger.info('orders 表已创建或已存在');
    } catch (err) {
        logger.error('创建 orders 表失败:', err);
    }
};

let connectPostgres = async () => {
    try {
        await pgPool.connect();
        logger.info("Postgres connected");
        await updateDatabaseNovi();
    } catch (err) {
        logger.error("Postgres connect failed", err);
    }
};

export { pgPool, connectPostgres };
