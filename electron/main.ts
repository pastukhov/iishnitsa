import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";
import Store from "electron-store";

const store = new Store();

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    titleBarStyle: "hiddenInset",
    show: false,
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle("store:get", (_, key: string) => {
  return store.get(key);
});

ipcMain.handle("store:set", (_, key: string, value: any) => {
  store.set(key, value);
});

ipcMain.handle("store:delete", (_, key: string) => {
  store.delete(key);
});

ipcMain.handle("fetch:request", async (_, url: string, options: RequestInit) => {
  try {
    const response = await fetch(url, options);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    
    const contentType = response.headers.get("content-type") || "";
    let body: any;
    
    if (contentType.includes("text/event-stream")) {
      body = await response.text();
    } else if (contentType.includes("application/json")) {
      body = await response.json();
    } else {
      body = await response.text();
    }
    
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers,
      body,
    };
  } catch (error: any) {
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
