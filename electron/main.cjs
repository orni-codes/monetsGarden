const { app, BrowserWindow, screen, ipcMain } = require("electron");
const path = require("path");

// ---- widget settings ----------------------------------------------------
// The garden window sits flush against the RIGHT edge of the work area and its
// bottom edge sits exactly on the top of the taskbar (the work area ends where
// the taskbar begins), so the plants appear to grow out of the taskbar.
const WIDGET = {
    widthRatio: 0.30,   // window width as a share of the work-area width ...
    minWidth: 360,      // ... kept between these limits
    maxWidth: 620,
    heightRatio: 0.85,  // window height as a share of the work-area height ...
    maxHeight: 900,     // ... up to this many pixels
    groundOverlap: 1    // px the window reaches past the work area, so display
                        // scaling can never leave a hairline gap above the taskbar
};
const CURSOR_POLL_MS = 33;   // desktop-wide cursor polling (~30 Hz)
const CURSOR_RANGE = 500;    // how far (px) outside the window the cursor still matters

// `npm start -- --debug` keeps the window clickable everywhere and opens DevTools
const DEBUG = process.argv.includes("--debug");
const CLICK_THROUGH = !DEBUG;

let mainWindow = null;
let pollTimer = null;
let lastSent;                // last cursor message sent to the renderer

// Right edge of the primary display's work area, resting on the taskbar.
function widgetBounds() {
    const area = screen.getPrimaryDisplay().workArea;

    const width = Math.min(
        area.width,
        Math.max(WIDGET.minWidth, Math.min(WIDGET.maxWidth, Math.round(area.width * WIDGET.widthRatio)))
    );
    const height = Math.min(area.height, Math.min(WIDGET.maxHeight, Math.round(area.height * WIDGET.heightRatio)));

    return {
        width,
        height: height + WIDGET.groundOverlap,
        x: area.x + area.width - width,
        y: area.y + area.height - height
    };
}

function sameMessage(a, b) {
    if (a === b) return true;
    return !!a && !!b && a.x === b.x && a.y === b.y;
}

// The page can only see the mouse while it is over the window, so the main
// process reads the system cursor and sends it, relative to the window, to the
// renderer. Only the position is shared, only when it changes, and nothing is
// sent while the cursor is far away from the widget.
function pollCursor() {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;

    const point = screen.getCursorScreenPoint();
    const bounds = mainWindow.getBounds();
    const x = point.x - bounds.x;
    const y = point.y - bounds.y;

    const near =
        x > -CURSOR_RANGE && y > -CURSOR_RANGE &&
        x < bounds.width + CURSOR_RANGE && y < bounds.height + CURSOR_RANGE;

    const message = near ? { x, y } : null;
    if (lastSent !== undefined && sameMessage(message, lastSent)) return;

    lastSent = message;
    mainWindow.webContents.send("bloom:cursor", message);
}

function startCursorPolling() {
    stopCursorPolling();
    lastSent = undefined;
    pollTimer = setInterval(pollCursor, CURSOR_POLL_MS);
}

function stopCursorPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        ...widgetBounds(),

        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        hasShadow: false,

        resizable: false,
        maximizable: false,
        minimizable: false,

        alwaysOnTop: true,
        skipTaskbar: true,

        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            preload: path.join(__dirname, "preload.cjs"),
            devTools: DEBUG
        }
    });

    // The window is a big transparent rectangle, so let clicks pass through to
    // the desktop except while the cursor is over a flower (the renderer tells
    // us via the "bloom:interactive" message below).
    if (CLICK_THROUGH) mainWindow.setIgnoreMouseEvents(true);

    // The widget never navigates or opens windows.
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

    mainWindow.loadFile("src/index.html");

    mainWindow.webContents.on("did-finish-load", startCursorPolling);
    if (DEBUG) mainWindow.webContents.openDevTools({ mode: "detach" });

    mainWindow.on("closed", () => {
        stopCursorPolling();
        mainWindow = null;
    });
}

// The renderer asks for mouse input only while the cursor is over a flower.
ipcMain.on("bloom:interactive", (event, wantsInput) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    if (typeof wantsInput !== "boolean" || !CLICK_THROUGH) return;
    mainWindow.setIgnoreMouseEvents(!wantsInput);
});

if (!app.requestSingleInstanceLock()) {
    // a widget is already running
    app.quit();
} else {
    app.whenReady().then(() => {
        createWindow();
        screen.on("display-metrics-changed", () => {
            if (mainWindow) mainWindow.setBounds(widgetBounds());
        });
    });
}

app.on("window-all-closed", () => {
    app.quit();
});