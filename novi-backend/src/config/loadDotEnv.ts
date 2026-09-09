import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

/**
 * 加载 .env。
 *
 * 默认 dotenv 只读 process.cwd()/.env，在 `npm start`（node dist/index.js）或从其他
 * 工作目录启动时会因 cwd 错位而读不到 .env。这里改为按模块自身位置向上查找项目根的
 * .env（src/config/ 或 dist/config/ 均为项目根下两级，向上最多 3 级即覆盖），与 cwd 解耦。
 * 若一个都没找到，回退到 dotenv 默认行为（cwd/.env）。
 */
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
    path.resolve(currentDir, '.env'),
    path.resolve(currentDir, '..', '.env'),
    path.resolve(currentDir, '..', '..', '.env'),
    path.resolve(currentDir, '..', '..', '..', '.env'),
];

const envFile = candidates.find((p) => {
    try {
        return fs.existsSync(p);
    } catch {
        return false;
    }
});

dotenv.config(envFile ? { path: envFile } : undefined);
