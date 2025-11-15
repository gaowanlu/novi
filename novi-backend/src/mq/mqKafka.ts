import { Kafka, Producer, Consumer, Admin } from 'kafkajs'
import type { Message, EachMessagePayload } from 'kafkajs'
import logger from '../logger.js'

const TOPIC = 'test-topic'

// Kafka Broker列表
const brokers: string[] = (process.env.KAFKA_BROKERS || '')
    .split(",")
    .filter((broker: string) => broker.trim().length > 0)

// 创建 Kafka 实例
const kafka = new Kafka({
    clientId: 'novi',
    brokers,
    connectionTimeout: 5000,
    retry: {
        initialRetryTime: 300,
        retries: 10
    }
})

/**
 * 创建或验证Kafka主题
 */
async function createTopic(): Promise<void> {
    let admin: Admin | null = null;
    try {
        admin = kafka.admin()
        await admin.connect()

        const topics = await admin.listTopics()

        if (!topics.includes(TOPIC)) {
            await admin.createTopics({
                topics: [{ topic: TOPIC, numPartitions: 1, replicationFactor: 1 }],
                waitForLeaders: true,
            })
            logger.info(`✅ Topic ${TOPIC} 已创建`)
        } else {
            logger.info(`✅ Topic ${TOPIC} 已存在`)
        }
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '未知错误'
        logger.error(`创建主题失败: ${errorMessage}`)
        throw err
    } finally {
        if (admin) {
            await admin.disconnect()
        }
    }
}

/**
 * 创建Kafka Producer
 * @returns Producer
 */
async function createProducer(): Promise<Producer> {
    try {
        const producer = kafka.producer()

        producer.on(producer.events.CONNECT, () =>
            logger.info('🟢 Kafka Producer 已连接')
        )
        producer.on(producer.events.DISCONNECT, () =>
            logger.warn('🔴 Kafka Producer 已断开')
        )
        producer.on(producer.events.REQUEST_TIMEOUT, (e: any) =>
            logger.warn(`⚠️ Producer 请求超时: ${e.payload.clientId}`)
        )

        await producer.connect()
        return producer
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '未知错误'
        logger.error(`创建 Producer 失败: ${errorMessage}`)
        throw err
    }
}

/**
 * 发送消息到 Kafka
 * @param producer - Kafka Producer实例
 */
async function producerRun(producer: Producer): Promise<void> {
    try {
        const result = await producer.send({
            topic: TOPIC,
            messages: [{ value: `heartbeat ${Date.now()}` }],
        })
        logger.info(`💌 Sent: ${JSON.stringify(result)}`)
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '未知错误'
        logger.error(`❌ Producer send 失败: ${errorMessage}`)
    }
}

/**
 * 创建Kafka Consumer
 * @returns Consumer
 */
async function createConsumer(): Promise<Consumer> {
    try {
        const consumer = kafka.consumer({ groupId: 'test-group' })

        consumer.on(consumer.events.CONNECT, () =>
            logger.info('🟢 Kafka Consumer 已连接')
        )
        consumer.on(consumer.events.DISCONNECT, () =>
            logger.warn('🔴 Kafka Consumer 已断开')
        )
        consumer.on(consumer.events.CRASH, (e: any) =>
            logger.error(`💥 Kafka Consumer 崩溃: ${e.payload.error.message}`)
        )
        consumer.on(consumer.events.HEARTBEAT, () =>
            logger.debug(`💓 Kafka Consumer Heartbeat @ ${new Date().toISOString()}`)
        )

        await consumer.connect()
        await consumer.subscribe({ topic: TOPIC, fromBeginning: false })

        await consumer.run({
            eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
                const messageValue = message.value?.toString() ?? ''
                logger.info(`📥 消费消息: ${messageValue}`)
            },
        })

        return consumer
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '未知错误'
        logger.error(`创建 Consumer 失败: ${errorMessage}`)
        throw err
    }
}

async function start(): Promise<void> {
    try {
        await createTopic()
        const producer = await createProducer()
        await createConsumer()

        // 每 10 秒发一次心跳
        setInterval(() => {
            producerRun(producer).catch((err: Error) => {
                logger.error(`心跳发送错误: ${err.message}`)
            })
        }, 10000)

        logger.info('✅ Kafka 服务已启动')
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '未知错误'
        logger.error(`启动 Kafka 服务失败: ${errorMessage}`)
        throw err
    }
}

function mqKafkaInit(): void {
    start().catch((err: Error) => {
        logger.error(`启动出错: ${err.message}`)
    })
}

export { mqKafkaInit };
