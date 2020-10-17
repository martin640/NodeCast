const { ServerLobby } = require("./PartyCast");
const LinuxOmxplayer = require("./partycastplayers/LinuxOmxplayer");

// config vars
const SERVER_PORT = "10784";
const SERVER_PARTY_TITLE = "Nodecast 1.1";
const SERVER_USERNAME = "Nodecast";
const SERVER_DEFAULT_VOLUME = "-300";
const SERVER_MUSIC_PLAYER_CONTROLLER = new LinuxOmxplayer(SERVER_DEFAULT_VOLUME);

// music library is loaded from folder "music" (relative to project)
// song artworks are cached into folder ".artwork_cache" (relative to project)

let lobby = new ServerLobby(SERVER_PARTY_TITLE, SERVER_PORT, SERVER_USERNAME, SERVER_MUSIC_PLAYER_CONTROLLER, {
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
