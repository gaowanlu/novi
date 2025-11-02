import logger from '../logger.js';

/**
 * schema: Joi schema 对象
 * property: 可选，'body' | 'params' | 'query'，默认 'body'
 */
const middlewareValidate = (schema, property = 'body') => (req, res, next) => {
    if (!['body', 'params', 'query'].includes(property)) {
        logger.error(`middlewareValidate property err ${property}`);
        property = 'body';
    }

    const source = req[property];
    const { error, value } = schema.validate(source);

    if (error) {
        logger.error(error.message);
        return res.status(400).json({ message: error.details[0].message });
    }

    // ✅ 对于 query，只能逐项赋值
    if (property === 'query') {
        Object.keys(value).forEach(k => {
            req.query[k] = value[k];
        });
    } else {
        req[property] = value; // body、params 可直接替换
    }

    next();
};

export default middlewareValidate;
