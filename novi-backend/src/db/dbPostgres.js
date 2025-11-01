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

let connectPostgres = async () => {
    try {
        await pgPool.connect();
        logger.info("Postgres connected");
    } catch (err) {
        logger.error("Postgres connect failed", err);
    }
};

export { pgPool, connectPostgres };
