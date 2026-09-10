// MongoDB 服务端错误码常量。
// 11000 (E11000) = 唯一索引冲突：文档违反集合上的唯一/部分唯一索引。
// 集中定义，避免在业务代码里散落魔法数字。
export const MONGO_E11000_DUPLICATE_KEY = 11000;

// Mongoose 把 Mongo 服务端错误（含 code/keyValue）挂到 Error 实例上，
// 但类型系统并不感知这些属性，统一经此收窄，免去各处 (err as any)。
export function isDuplicateKeyError(err: unknown): err is Error & { keyValue?: Record<string, unknown> } {
    return err instanceof Error && (err as { code?: unknown }).code === MONGO_E11000_DUPLICATE_KEY;
}
