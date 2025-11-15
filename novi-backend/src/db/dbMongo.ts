import mongoose from 'mongoose'
import type { Connection } from 'mongoose'
import logger from '../logger.js'
import { onMongoConnected } from '../models/mongoModel.js'

/**
 * 连接 MongoDB 数据库
 * 初始化数据库连接并同步索引
 */
const connectMongo = async (): Promise<Connection> => {
    try {
        const mongoUri = process.env.MONGO_URI

        if (!mongoUri) {
            throw new Error('缺少 MONGO_URI 环境变量')
        }

        await mongoose.connect(mongoUri, {
            retryWrites: true,
            w: 'majority',
        })

        logger.info('MongoDB 已连接')

        // 同步所有数据库索引
        await onMongoConnected()

        return mongoose.connection
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '未知错误'
        logger.error(`MongoDB 连接失败: ${errorMessage}`)
        throw err
    }
}

/**
 * 断开 MongoDB 连接
 */
const disconnectMongo = async (): Promise<void> => {
    try {
        await mongoose.disconnect()
        logger.info('MongoDB 已断开连接')
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '未知错误'
        logger.error(`MongoDB 断开连接失败: ${errorMessage}`)
        throw err
    }
}

/**
 * 获取 MongoDB 连接实例
 */
const getMongoConnection = (): Connection => {
    return mongoose.connection
}

export { connectMongo, disconnectMongo, getMongoConnection }
