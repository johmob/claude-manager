// Exposes the typed IPC bridge `window.cm` to the renderer. Nothing else crosses the boundary.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { RendererApi } from '../shared/contracts';

const api: RendererApi = {
  invoke: (channel, req) => ipcRenderer.invoke(channel, req),
  on: (channel, listener) => {
    const handler = (_event: IpcRendererEvent, payload: Parameters<typeof listener>[0]): void => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => void ipcRenderer.removeListener(channel, handler);
  },
  pathForFile: (f) => webUtils.getPathForFile(f),
};

contextBridge.exposeInMainWorld('cm', api);
