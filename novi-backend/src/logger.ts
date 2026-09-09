import winston from 'winston'
import 'winston-daily-rotate-file'
import path from 'path'
import type { Logger, Logform } from 'winston'

// 扩展 TransformableInfo，携带自定义的 location 字段（文件:行号）
type LogInfo = Logform.TransformableInfo & { location?: string }

/**
 * 自定义格式：带文件与行号
 * 在开发环境中显示日志所在的文件位置和行号
 */
const callerInfo: Logform.FormatWrap = winston.format((
    info: Logform.TransformableInfo,
): Logform.TransformableInfo => {
    const stack = new Error().stack?.split('\n')[10]
    if (stack) {
        const match = stack.match(/\((.*):(\d+):(\d+)\)/)
        if (match) {
            const filePath: string = path.relative(process.cwd(), match[1]);
            (info as LogInfo).location = `${filePath}:${match[2]}`
        }
    }
    return info
})

/**
 * 日志输出格式定义
 */
const logFormat: Logform.Format = winston.format.printf((info: Logform.TransformableInfo): string => {
    const { timestamp, level, message, location } = info as LogInfo
    return `[${timestamp}] ${level.toUpperCase()}${location ? ` (${location})` : ''}: ${message}`
})

/**
 * 滚动文件传输配置
 */
const fileRotateTransport = new winston.transports.DailyRotateFile({
    filename: 'logs/%DATE%.log',
    datePattern: 'YYYY-MM-DD-HH',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
})

/**
 * 控制台输出传输（带颜色）
 */
const consoleTransport: winston.transports.ConsoleTransportInstance = new winston.transports.Console({
    format: winston.format.combine(winston.format.colorize({ all: true })),
})

/**
 * 创建并配置 Logger 实例
 * 在生产环境中只输出 info 及以上级别，开发环境输出 debug 及以上级别
 */
const logger: Logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.errors({ stack: true }),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        ...(process.env.NODE_ENV === 'production' ? [] : [callerInfo()]), // 开发环境显示行号
        logFormat,
    ),
    transports: [consoleTransport, fileRotateTransport],
    exceptionHandlers: [fileRotateTransport],
    rejectionHandlers: [fileRotateTransport],
})

export default logger
