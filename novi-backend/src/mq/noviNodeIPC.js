import { mqKafkaInit } from './mqKafka.js'
import { mqRabbitMQInit, rabbitMQNoviNodeChannel } from './mqRabbitmq.js'
import logger from '../logger.js'

let noviNodeIPC = {
    init() {
        mqKafkaInit();
        mqRabbitMQInit((msgFromNoviNode) => {
            try {
                const json = JSON.parse(msgFromNoviNode);
                if (json) {
                    let message = JSON.parse(json.message);
                    this.msgFromNoviNode(json.fromNode, json.event, message);
                }
            } catch (err) {
                logger.error(`mqRabbitMQInit msgFromNoviNode ${err.message}`);
            }
        });
        // setInterval(() => {
        //     this.sendToNode(1, this.createNewMessage("test", {
        //         data: 'test data'
        //     }));
        // }, 1000);
    },

    sendToNode(noviNode, msg) {
        let jsonStr = JSON.stringify(msg);
        rabbitMQNoviNodeChannel.sendToNoviNode(noviNode, jsonStr);
    },

    createNewMessage(event, message) {
        let JsonStr = JSON.stringify(message);
        return {
            fromNode: process.env.NOVI_NODE,
            event,
            message: JsonStr
        };
    },

    msgFromNoviNode(fromNode, event, message) {
        logger.error(`fromNode ${fromNode} event ${event} message ${JSON.stringify(message)}`);
    }
};

export { noviNodeIPC };
