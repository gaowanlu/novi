import logger from '../logger.js';

/**
 * schema: Joi schema 对象
 * property: 可选，'body' | 'params' | 'query'，默认 'body'
 */
const middlewareValidate = (schema, property = 'body') => (req, res, next) => {
    if (property !== 'body' && property !== 'params' && property != 'query') {
        logger.error(`middlewareValidate property err ${property}`);
        property = 'body';
    }

    const source = req[property];
    const { error, value } = schema.validate(source);

    if (error) {
        logger.error(error.message);
        return res.status(400).json({ message: error.details[0].message });
    }

    // ✅ 自动替换为清理后的数据（含 trim 后的值）
    req[property] = value;

    next();
};

export default middlewareValidate;
