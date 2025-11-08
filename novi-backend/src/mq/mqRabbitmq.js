import amqp from 'amqplib/callback_api.js'
import logger from '../logger.js'

const QUEUE = `/novi_node/${process.env.NOVI_NODE}/heartbeat`;
const RABBITMQ_URI = process.env.RABBITMQ_URI;
const RECONNECT_DELAY = 5000 // 5 秒后重试

// 连接生产者
function createHeartbeatProducer() {
    amqp.connect(RABBITMQ_URI, (err, connection) => {
        if (err) {
            logger.error(`[RabbitMQ]${QUEUE} 生产者连接失败: ${err.message}`)
            setTimeout(connectProducer, RECONNECT_DELAY)
            return
        }

        connection.on('error', (err) => {
            logger.error(`[RabbitMQ]${QUEUE} 生产者连接错误: ${err.message}`)
        })

        connection.on('close', () => {
            logger.warn(`[RabbitMQ]${QUEUE} 生产者连接断开，${RECONNECT_DELAY}秒后重连...`)
            setTimeout(createHeartbeatProducer, RECONNECT_DELAY)
        })

        connection.createChannel((error1, channel) => {
            if (error1) {
                logger.error(`[RabbitMQ]${QUEUE} 创建生产通道失败: ${error1.message}`)
                return
            }

            channel.assertQueue(QUEUE, { durable: false })

            setInterval(() => {
                const msg = `${Date.now()}`
                channel.sendToQueue(QUEUE, Buffer.from(msg))
                logger.info(`[RabbitMQ]${QUEUE} Sent heartbeat: ${msg}`)
            }, 5000)
        })
    })
}

// 连接消费者
function createHeartbeatConsumer() {
    amqp.connect(RABBITMQ_URI, (err, connection) => {
        if (err) {
            logger.error(`[RabbitMQ]${QUEUE} 消费者连接失败: ${err.message}`)
            setTimeout(connectConsumer, RECONNECT_DELAY)
            return
        }

        connection.on('error', (err) => {
            logger.error(`[RabbitMQ]${QUEUE} 消费者连接错误: ${err.message}`)
        })

        connection.on('close', () => {
            logger.warn(`[RabbitMQ]${QUEUE} 消费者连接断开，${RECONNECT_DELAY}秒后重连...`)
            setTimeout(connectConsumer, RECONNECT_DELAY)
        })

        connection.createChannel((error1, channel) => {
            if (error1) {
                logger.error(`[RabbitMQ]${QUEUE} 创建消费通道失败: ${error1.message}`)
                return
            }

            channel.assertQueue(QUEUE, { durable: false })
            channel.consume(
                QUEUE,
                (msg) => {
                    logger.info(`[RabbitMQ]${QUEUE} Received heartbeat: ${msg.content.toString()}`)
                },
                { noAck: true }
            )
        })
    })
}

createHeartbeatProducer();
createHeartbeatConsumer();
