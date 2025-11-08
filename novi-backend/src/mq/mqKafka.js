import { Kafka } from 'kafkajs'
import logger from '../logger.js'

const brokers = (process.env.KAFKA_BROKERS || "").split(",").filter(Boolean)
const kafka = new Kafka({
    clientId: 'novi',
    brokers,
    connectionTimeout: 5000,
    retry: {
        initialRetryTime: 300,
        retries: 10
    }
})

const TOPIC = 'test-topic'

async function create_topic() {
    const admin = kafka.admin()
    await admin.connect()
    const topics = await admin.listTopics()

    if (!topics.includes(TOPIC)) {
        await admin.createTopics({
            topics: [{ topic: TOPIC, numPartitions: 1, replicationFactor: 1 }],
            waitForLeaders: true
        })
        logger.info(`✅ Topic ${TOPIC} 已创建`)
    } else {
        logger.info(`✅ Topic ${TOPIC} 已存在`)
    }

    await admin.disconnect()
}

async function create_producer() {
    const producer = kafka.producer()
    producer.on(producer.events.CONNECT, () => logger.info('🟢 Kafka Producer 已连接'))
    producer.on(producer.events.DISCONNECT, () => logger.warn('🔴 Kafka Producer 已断开'))
    producer.on(producer.events.REQUEST_TIMEOUT, e => logger.warn(`⚠️ Producer 请求超时: ${e.payload.clientId}`))

    await producer.connect()
    return producer
}

async function producer_run(producer) {
    try {
        const result = await producer.send({
            topic: TOPIC,
            messages: [{ value: `heartbeat ${Date.now()}` }],
        })
        logger.info(`💌 Sent: ${JSON.stringify(result)}`)
    } catch (err) {
        logger.error(`❌ Producer send 失败: ${err.message}`)
    }
}

async function create_consumer() {
    const consumer = kafka.consumer({ groupId: 'test-group' })

    consumer.on(consumer.events.CONNECT, () => logger.info('🟢 Kafka Consumer 已连接'))
    consumer.on(consumer.events.DISCONNECT, () => logger.warn('🔴 Kafka Consumer 已断开'))
    consumer.on(consumer.events.CRASH, e => logger.error(`💥 Kafka Consumer 崩溃: ${e.payload.error.message}`))
    consumer.on(consumer.events.HEARTBEAT, e => logger.debug(`💓 Kafka Consumer Heartbeat @ ${new Date().toISOString()}`))

    await consumer.connect()
    await consumer.subscribe({ topic: TOPIC, fromBeginning: false })

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            logger.info(`📥 消费消息: ${message.value.toString()}`)
        }
    })

    return consumer
}

async function start() {
    await create_topic()
    const producer = await create_producer()
    await create_consumer()

    // 每 10 秒发一次心跳
    setInterval(() => producer_run(producer), 10000)
}

function mqKafkaInit() {
    start().catch(err => logger.error(`启动出错: ${err.message}`))
}

export { mqKafkaInit };
