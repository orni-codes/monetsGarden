const { app, BrowserWindow, screen } = require("electron");

let mainWindow;

function createWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    const windowWidth = 400;
    const windowHeight = 450;

    mainWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,

        x: width - windowWidth - 20,
        y: height - windowHeight - 20,

        frame: false,
        transparent: true,
        backgroundColor: "#00000000",

        resizable: false,
        maximizable: false,
        minimizable: false,

        alwaysOnTop: true,
        skipTaskbar: true,

        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile("src/index.html");
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
    app.quit();
});