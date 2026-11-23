import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface JsonStore<T> {
  read(): T;
  write(value: T): void;
}

export function createJsonStore<T>(
  filePath: string,
  defaults: T,
  validate?: (raw: unknown) => T | null,
): JsonStore<T> {
  return {
    read(): T {
      try {
        const raw: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
        return validate ? (validate(raw) ?? defaults) : (raw as T);
      } catch {
        return defaults;
      }
    },
    write(value: T): void {
      mkdirSync(dirname(filePath), { recursive: true });
      const tmp = `${filePath}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
      renameSync(tmp, filePath);
    },
  };
}
