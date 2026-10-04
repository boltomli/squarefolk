/** 收集黄金向量目录下全部 .json 用例文件（隐藏文件除外），按路径升序（§6 向量纪律：顺序确定）。 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export function collectVectorFiles(dir: string): string[] {
  const names = fs.readdirSync(dir, { recursive: true }) as string[];
  return names
    .filter((name) => name.endsWith('.json') && !path.basename(name).startsWith('.'))
    .map((name) => path.join(dir, name))
    .sort();
}
