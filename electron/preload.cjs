// Preload script: the only bridge between the page and Electron.
// It exposes two tiny functions and nothing else: no Node.js, no ipcRenderer.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bloomHost", {
    // Calls cb({ x, y }) with the system cursor position relative to the window
    // (CSS pixels, may be outside the window), or cb(null) when the cursor is far
    // away. Returns a function that unsubscribes.
    onCursor(cb) {
        if (typeof cb !== "function") return () => {};

        const handler = (_event, point) => {
            if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
                cb({ x: point.x, y: point.y });
            } else {
                cb(null);
            }
        };

        ipcRenderer.on("bloom:cursor", handler);
        return () => ipcRenderer.removeListener("bloom:cursor", handler);
    },

    // true while the cursor is over a flower (the window should take clicks),
    // false otherwise (clicks pass through to the desktop).
    setInteractive(wantsInput) {
        ipcRenderer.send("bloom:interactive", wantsInput === true);
    }
});