const {app, BrowserWindow, Tray, Menu, Notification} = require('electron');
const packageInfo = require('../package.json');

if (process.env.npm_package_version.includes("-dev")) {
    console.warn("WARNING: This version is not intended to be run on production server!!");
    console.warn("*-dev versions are quick saves of development progress and may contain bugs/unintended links/references.");
    console.warn("Please check git repo for stable release.");
}

function createWindow() {
    const window = new BrowserWindow({
        width: 1500,
        height: 1000,
        webPreferences: {
            nodeIntegration: true
        },
        icon: __dirname + '/app.ico'
    });
    window.removeMenu();

    window.tray = new Tray(__dirname + '/app.ico');
    window.tray.setContextMenu(Menu.buildFromTemplate([
        {label: `${packageInfo.name} ${packageInfo.version}`, enabled: false},
        {label: 'Open Nodecast', click: () => window.show()},
        {
            label: 'Quit', click: () => {
                app.isQuiting = true;
                app.quit();
            }
        }
    ]));
    window.tray.on('click', () => window.show());

    const showNotification = () => {
        if (app.notificationShown) return;

        const mNotification = new Notification({
            title: 'Nodecast has been minimized to the tray',
            body: 'Click icon in tray or this notification to open Nodecast',
            silent: true
        });
        mNotification.on('click', () => window.show());
        mNotification.show();
        app.notificationShown = true;
    }

    window.on('minimize', (event) => {
        event.preventDefault();
        window.hide();
        showNotification();
    });
    window.on('close', (event) => {
        if (!app.isQuiting) {
            event.preventDefault();
            window.hide();
            showNotification();
        }
        return false;
    });

    window.loadFile('assets/index.html');
    window.webContents.openDevTools();
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
