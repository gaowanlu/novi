import winston from 'winston';
import 'winston-daily-rotate-file';

const { combine, timestamp, printf } = winston.format;

const logFormat = printf(({ timestamp, level, message }) => {
    return `[${timestamp}] ${level}: ${message}`;
});

// 每小时滚动一次
const transport = new winston.transports.DailyRotateFile({
    filename: 'logs/%DATE%.log',   // 日志文件存放目录
    datePattern: 'YYYY-MM-DD-HH',  // 每小时一个文件
    zippedArchive: true,           // 压缩旧文件
    maxSize: '20m',                // 单文件最大 20MB
    maxFiles: '14d',               // 保存最近 14 天日志
});

const logger = winston.createLogger({
    level: 'info',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
    ),
    transports: [
        new winston.transports.Console(),
        transport
    ],
});

export default logger;
