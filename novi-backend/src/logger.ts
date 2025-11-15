import winston from 'winston'
import 'winston-daily-rotate-file'
import path from 'path'

const { combine, timestamp, printf, colorize, errors } = winston.format

// 🧩 自定义格式：带文件与行号
const callerInfo = winston.format((info) => {
    const stack = new Error().stack?.split('\n')[10]
    if (stack) {
        const match = stack.match(/\((.*):(\d+):(\d+)\)/)
        if (match) {
            const filePath = path.relative(process.cwd(), match[1])
            info.location = `${filePath}:${match[2]}`
        }
    }
    return info
})

// 🎨 格式定义
const logFormat = printf(({ timestamp, level, message, location }) => {
    return `[${timestamp}] ${level.toUpperCase()}${location ? ` (${location})` : ''}: ${message}`
})

// 📦 滚动文件配置
const fileRotateTransport = new winston.transports.DailyRotateFile({
    filename: 'logs/%DATE%.log',
    datePattern: 'YYYY-MM-DD-HH',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
})

// 🌈 控制台输出（带颜色）
const consoleTransport = new winston.transports.Console({
    format: combine(colorize({ all: true })),
})

// 🧱 构建 Logger
const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: combine(
        errors({ stack: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        ...(process.env.NODE_ENV === 'production' ? [] : [callerInfo()]), // 开发环境显示行号
        logFormat
    ),
    transports: [consoleTransport, fileRotateTransport],
    exceptionHandlers: [fileRotateTransport],
    rejectionHandlers: [fileRotateTransport],
})

// ✅ 导出
export default logger
