import amqp from 'amqplib/callback_api.js'
import logger from '../logger.js'

const QUEUE = 'heartbeat';
const RABBITMQ_URI = process.env.RABBITMQ_URI;
const RECONNECT_DELAY = 5000 // 5 秒后重试

// 连接生产者
function connectProducer() {
    amqp.connect(RABBITMQ_URI, (err, connection) => {
        if (err) {
            logger.error(`[RabbitMQ] 生产者连接失败: ${err.message}`)
            setTimeout(connectProducer, RECONNECT_DELAY)
            return
        }

        connection.on('error', (err) => {
            logger.error(`[RabbitMQ] 生产者连接错误: ${err.message}`)
        })

        connection.on('close', () => {
            logger.warn('[RabbitMQ] 生产者连接断开，5 秒后重连...')
            setTimeout(connectProducer, RECONNECT_DELAY)
        })

        connection.createChannel((error1, channel) => {
            if (error1) {
                logger.error(`[RabbitMQ] 创建生产通道失败: ${error1.message}`)
                return
            }

            channel.assertQueue(QUEUE, { durable: false })

            setInterval(() => {
                const msg = `${Date.now()}`
                channel.sendToQueue(QUEUE, Buffer.from(msg))
                logger.info(` [>] Sent heartbeat: ${msg}`)
            }, 5000)
        })
    })
}

// 连接消费者
function connectConsumer() {
    amqp.connect(RABBITMQ_URI, (err, connection) => {
        if (err) {
            logger.error(`[RabbitMQ] 消费者连接失败: ${err.message}`)
            setTimeout(connectConsumer, RECONNECT_DELAY)
            return
        }

        connection.on('error', (err) => {
            logger.error(`[RabbitMQ] 消费者连接错误: ${err.message}`)
        })

        connection.on('close', () => {
            logger.warn('[RabbitMQ] 消费者连接断开，5 秒后重连...')
            setTimeout(connectConsumer, RECONNECT_DELAY)
        })

        connection.createChannel((error1, channel) => {
            if (error1) {
                logger.error(`[RabbitMQ] 创建消费通道失败: ${error1.message}`)
                return
            }

            channel.assertQueue(QUEUE, { durable: false })
            channel.consume(
                QUEUE,
                (msg) => {
                    logger.info(` [<] Received heartbeat: ${msg.content.toString()}`)
                },
                { noAck: true }
            )
        })
    })
}

connectProducer();
connectConsumer();
