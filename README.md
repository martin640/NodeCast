# partycast-js

partycast-js is NodeJS implementation of PartyCast server allowing it to be run on embedded devices.

Usage:
```
const PartyCast = require("partycast-js");

const controller = {
    name: "DummyPlayer",
    playing: false,
    killed: false,

    // if controller depends on external command or program that needs to be loaded
    // check if it's available and return self or throw error
    checkAvailable: function () { return Promise.resolve(this) },
    prepare: function (lobby) { },
    play: function (file, callback) {
        this.playing = true;
    },
    pause: function () {
        if (this.playing) {
            this.playing = false;
        }
    },
    resume: function () {
        if (!this.playing) {
            this.playing = true;
        }
    },
    kill: function () { },
    getPosition: () => 0,
    getVolumeControl() {
        return {
            level: 1, // 0-1
            muted: false,
            setLevel(v) {},
            setMuted(v) {}
        }
    },
    isPlaying: function () { return this.playing }
};

const config = {
    title: "Server Title",
    serverPort: 10784,
    username: "Server Display Username in members list",
    player: controller,
    libraryLocation: "~/Music",
    artworkCacheLocation: "~/.nodecast/cache",
    actionBoard: (client, changeHandler) => ({
        client, changeHandler,
        number: 0,
        generate() {
            // geenerate action board for provided user
            return [
                {
                    "id": 512,
                    "itemType": 0,
                    "inputType": 0,
                    "title": "Example section",
                },
                {
                    "id": 513,
                    "itemType": 1,
                    "inputType": 0,
                    "body": `Current counter value: <b><font color="#1f3c88">${this.number}</font></b>`
                },
                {
                    "id": 514,
                    "itemType": 2,
                    "inputType": 1,
                    "clickable": true,
                    "body": 'Click to increase value'
                }
            ];
        },
        handleInput(itemId, value) {
            if (itemId === 514) {
                this.number++;
                this.changeHandler();
                return "OK";
            }
            throw "Unknown item id";
        }
    }),
    listener: {
        // events list copied from android implementation
        onConnected(lobby) { },
        onUserJoined(lobby, member) { },
        onUserLeft(lobby, member) { },
        onUserUpdated(lobby, member) { },
        onDisconnect(lobby, code, reason) { },
        onError(lobby, error) { },
        onLobbyStateChanged(lobby) { },
        onLooperUpdated(lobby, looper) { },
        onLibraryUpdated(lobby, libraryProvider) { }
    }
};

const lobby = new PartyCast.ServerLobby(config);
// do stuff
```
