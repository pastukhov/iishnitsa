"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("electronAPI", {
    store: {
        get: (key) => electron_1.ipcRenderer.invoke("store:get", key),
        set: (key, value) => electron_1.ipcRenderer.invoke("store:set", key, value),
        delete: (key) => electron_1.ipcRenderer.invoke("store:delete", key),
    },
    fetch: (url, options) => electron_1.ipcRenderer.invoke("fetch:request", url, options),
});
