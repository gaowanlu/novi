import { mqKafkaInit } from './mqKafka.js'
import { mqRabbitMQInit, rabbitMQNoviNodeChannel } from './mqRabbitmq.js'
import logger from '../logger.js'

let noviNodeIPC = {
    init() {
        mqKafkaInit();
        mqRabbitMQInit((msgFromNoviNode) => {
            logger.error(`mqRabbitMQ msgFromNoviNode ${msgFromNoviNode}`);
            rabbitMQNoviNodeChannel.sendToNoviNode(1, "hello world");
        });
    },
    sendToNode(noviNode, msg) {
        rabbitMQNoviNodeChannel.sendToNoviNode(noviNode, "hello world");
    }
};

export { noviNodeIPC };
