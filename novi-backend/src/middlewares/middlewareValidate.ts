import type { Response, NextFunction } from 'express';
import type { ObjectSchema } from 'joi';
import logger from '../logger.js';
import { IRequest } from '../comm/request.js';

// 验证属性的类型 Literal Union Type
type ValidateProperty = 'body' | 'params' | 'query';
const validProperties: ValidateProperty[] = ['body', 'params', 'query'];

/**
 * 数据验证中间件工厂函数
 * @param schema - Joi schema 对象
 * @param property - 验证属性，可选值为 'body' | 'params' | 'query'，默认为 'body'
 * @returns 中间件函数
 */
const middlewareValidate = (
    schema: ObjectSchema,
    property: ValidateProperty = 'body'
) => {
    return (req: IRequest, res: Response, next: NextFunction): void => {
        // 验证 property 参数是否有效
        if (!validProperties.includes(property)) {
            logger.error(`middlewareValidate property err ${property}`);
            property = 'body';
        }

        // 获取要验证的数据源
        const source = req[property];

        // 使用 Joi schema 验证数据
        const { error, value } = schema.validate(source, {
            abortEarly: false,
            stripUnknown: true,
        })

        // 验证失败，返回错误信息
        if (error) {
            logger.error(`验证失败: ${error.message}`)
            res.status(400).json({
                message: error.details[0]?.message || '请求数据验证失败',
                details: error.details,
            })
            return
        }

        // 验证成功，更新请求对象中的数据
        if (property === 'query') {
            // 对于 query，需要逐项赋值
            Object.keys(value).forEach((key: string) => {
                req.query[key] = value[key]
            })
        } else {
            // 对于 body 和 params，可直接替换
            req[property] = value
        }

        next();
    }
};

export default middlewareValidate;
