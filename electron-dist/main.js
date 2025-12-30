"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const electron_store_1 = __importDefault(require("electron-store"));
const store = new electron_store_1.default();
let mainWindow = null;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 400,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path_1.default.join(__dirname, "preload.js"),
        },
        titleBarStyle: "hiddenInset",
        show: false,
    });
    if (process.env.NODE_ENV === "development") {
        mainWindow.loadURL("http://localhost:5173");
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, "../dist/index.html"));
    }
    mainWindow.once("ready-to-show", () => {
        mainWindow?.show();
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: "deny" };
    });
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}
electron_1.app.whenReady().then(createWindow);
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        electron_1.app.quit();
    }
});
electron_1.app.on("activate", () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
electron_1.ipcMain.handle("store:get", (_, key) => {
    return store.get(key);
});
electron_1.ipcMain.handle("store:set", (_, key, value) => {
    store.set(key, value);
});
electron_1.ipcMain.handle("store:delete", (_, key) => {
    store.delete(key);
});
electron_1.ipcMain.handle("fetch:request", async (_, url, options) => {
    try {
        const response = await fetch(url, options);
        const headers = {};
        response.headers.forEach((value, key) => {
            headers[key] = value;
        });
        const body = await response.text();
        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers,
            body,
        };
    }
    catch (error) {
        return {
            ok: false,
            status: 0,
            statusText: error.message,
            headers: {},
            body: null,
            error: error.message,
        };
    }
});
