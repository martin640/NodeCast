const { app, BrowserWindow } = require('electron');

if (process.env.npm_package_version.includes("-dev")) {
    console.warn("WARNING: This version is not intended to be run on production server!!");
    console.warn("*-dev versions are quick saves of development progress and may contain bugs/unintended links/references.");
    console.warn("Please check git repo for stable release.");
}

function createWindow() {
    const window = new BrowserWindow({
        width: 1200,
        height: 900,
        webPreferences: {
            nodeIntegration: true
        },
        icon: __dirname + '/app.ico'
    });
    //window.maximize();
    window.removeMenu();

    window.loadFile('assets/index.html');
    //window.webContents.openDevTools();
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
