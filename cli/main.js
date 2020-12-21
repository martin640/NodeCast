const promiseAny = require('promise-any');
const { ServerLobby, compactTime } = require("../PartyCast")
const configJson = require('../partycast.json') || {}
const fallbackConfig = configJson.disable_example_as_fallback ? {} : (require('../partycast.example.json') || {})

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
        title: configJson.party_title || fallbackConfig.party_title,
        serverPort: configJson.ws_port || fallbackConfig.ws_port,
        username: configJson.party_host_username || fallbackConfig.party_host_username,
        player: controller,
        libraryLocation: configJson.music_src || fallbackConfig.music_src,
        artworkCacheLocation: configJson.music_artwork_cache_src || fallbackConfig.music_artwork_cache_src,
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