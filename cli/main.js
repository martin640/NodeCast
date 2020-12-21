const promiseAny = require('promise-any');
const { ServerLobby, compactTime } = require("../PartyCast");
const configJson = require('../partycast.json') || {};
const os = require("os");

const LinuxOmxplayer = require("./partycastplayers/LinuxOmxplayer");
const DummyPlayer = require("./partycastplayers/DummyPlayer");

console.log(`[index.js @ ${compactTime()}] Initializing Nodecast...`);

if (process.env.npm_package_version.includes("-dev")) {
    console.warn("WARNING: This version is not intended to be run on production server!!");
    console.warn("*-dev versions are quick saves of development progress and may contain bugs/unintended links/references.");
    console.warn("Please check git repo for stable release.");
}

const SERVER_MUSIC_PLAYER_CONTROLLERS = [
    new LinuxOmxplayer(/* volume */ "-300").checkAvailable(),
    DummyPlayer.checkAvailable()
];

console.log(`[index.js @ ${compactTime()}] Looking for music player controller...`);

promiseAny(SERVER_MUSIC_PLAYER_CONTROLLERS).then((controller) => {
    console.log(`[index.js @ ${compactTime()}] Picked \"${controller.constructor.name}\" as music player controller`);

    let config = {
        title: configJson.party_title || os.hostname(),
        serverPort: configJson.ws_port || 10784,
        username: configJson.party_host_username || os.userInfo().username,
        player: controller,
        libraryLocation: configJson.music_dir || (os.homedir() + "/Music"),
        dataLocation: configJson.data_dir || (os.homedir() + "/.nodecast"),
        listener: {
            // events list copied from android implementation
            onConnected: function(lobby) { },
            onUserJoined: function (lobby, member) { },
            onUserLeft: function (lobby, member) { },
            onUserUpdated: function (lobby, member) { },
            onDisconnect: function (lobby, code, reason) { },
            onError: function (lobby, error) { },
            onLobbyStateChanged: function (lobby) { },
            onLooperUpdated: function (lobby, looper) { },
            onLibraryUpdated: function (lobby, libraryProvider) { }
        }
    };

    let lobby = new ServerLobby(config);
}).catch((err) => {
    console.error(`[index.js @ ${compactTime()}] Failed to initialize server because no suitable music player is available for this platform.`);
    console.error(`[index.js @ ${compactTime()}] Cause: ${err}`);
})
