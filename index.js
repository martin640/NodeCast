const { ServerLobby } = require("./PartyCast");
const LinuxOmxplayer = require("./partycastplayers/LinuxOmxplayer");

// config vars
const SERVER_PORT = "10784";
const SERVER_PARTY_TITLE = "Nodecast 1.1";
const SERVER_USERNAME = "Nodecast";
const SERVER_DEFAULT_VOLUME = "-400";

// music library is load from folder "music" (relative to project)
// song artworks are cached into folder ".artwork_cache" (relative to project)

const lobby = new ServerLobby(SERVER_PARTY_TITLE, SERVER_PORT, SERVER_USERNAME, new LinuxOmxplayer(SERVER_DEFAULT_VOLUME), {
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
});
