import type { IpcInvokeChannel, IpcInvokeMap } from '../../../shared/contracts';

/** Fire-and-forget invoke: failures are logged, never thrown into render code. */
export function send<K extends IpcInvokeChannel>(channel: K, req: IpcInvokeMap[K]['req']): void {
  window.cm.invoke(channel, req).catch((e: unknown) => console.error(channel, e));
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
