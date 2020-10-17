const WebSocketServer = require('websocket').server;
const http = require('http');
const fs = require('fs');
const mm = require('music-metadata');

const PERMISSION_CHANGE_NAME = 1;
const PERMISSION_QUEUE = 2;
const PERMISSION_MEMBER_LIST = 4;
const PERMISSION_MANAGE_USERS = 8;
const PERMISSION_MANAGE_QUEUE = 16;
const PERMISSION_OWNER = 64;
const PERMISSION_HOST = 0b111111111111111111111111111111;

const PERMISSIONS_DEFAULT = PERMISSION_CHANGE_NAME | PERMISSION_QUEUE | PERMISSION_MEMBER_LIST;
const PERMISSIONS_MOD = PERMISSIONS_DEFAULT | PERMISSION_MANAGE_USERS | PERMISSION_MANAGE_QUEUE;

const STATE_CREATED = 0;
const STATE_CONNECTING = 1;
const STATE_OPEN = 2;
const STATE_CLOSED = 3;

const PLAYBACK_READY = 0;
const PLAYBACK_PLAYING = 1;
const PLAYBACK_PAUSED = 2;

function serialize(obj) {
    if (typeof obj.toJson === "function") return obj.toJson();
    else return {};
}
function serializeArray(arr) {
    let ret = [];
    if (!Array.isArray(arr)) return ret;
    for (let i = 0; i < arr.length; i++) {
        ret.push(serialize(arr[i]));
    }
    return ret;
}

const LobbyMember = class {
    constructor(name, id, permissions, agent, connection, lobby) {
        this.name = name;
        this.id = id;
        this.permissions = permissions;
        this.agent = agent;
        this.connection = connection;
        this.lobby = lobby;
    }

    checkPermission(bit) {
        return ((this.permissions & bit) === bit);
    }

    toJson() {
        return {
            class: "LobbyMember",
            values: {
                name: this.name,
                agent: this.agent,
                id: this.id,
                permissions: this.permissions,
                address: (this.connection) ? this.connection.remoteAddress : ""
            }
        }
    }
}

const LibraryItem = class {
    constructor(id, artwork, title, artist, album, length, file, provider) {
        this.id = id;
        this.artwork = artwork;
        this.title = title;
        this.artist = artist;
        this.length = length;
        this.album = album;
        this.path = file;
        this.provider = provider;
    }

    toJson() {
        return {
            class: "LibraryItem",
            values: {
                id: this.id,
                title: this.title,
                artist: this.artist,
                album: this.album,
                imageUrl: this.artwork ? `http://[HOST]:${this.provider.context.port}/art/${this.artwork}` : null,
            }
        }
    }
}

const LibraryProvider = class {
    constructor(src, lobby) {
        this.location = src;
        this.context = lobby;
        this.items = [];
        this.idPool = 0;
    }

    reload() {
        let self = this;
        return new Promise(function (resolve, reject) {
            self.items = [];
            let pendingPromises = [];
            fs.readdirSync(self.location).forEach(file => {
                let absPath = self.location + "/" + file;
                fs.mkdirSync(".artwork_cache", { recursive: true })
                pendingPromises.push(new Promise(function (resolve, reject) {
                    mm.parseFile(absPath).then(metadata => {
                        if (Array.isArray(metadata.common.picture) && metadata.common.picture.length > 0) {
                            if (!fs.existsSync(".artwork_cache/" + file + ".jpg")) {
                                let picture = metadata.common.picture[0];
                                fs.writeFile(".artwork_cache/" + file + ".jpg", picture.data, "binary", function(err) { });
                            }
                        }

                        self.items.push(new LibraryItem(++self.idPool, file + ".jpg",
                            metadata.common.title, metadata.common.artist, metadata.common.album, metadata.format.duration * 1000,
                            absPath, self));
                        resolve();
                    }).catch(err => {
                        reject(err);
                    });
                }));
            });

            Promise.allSettled(pendingPromises).then(function (res) {
                resolve(self);
            });
        });
    }

    toJson() {
        return {
            class: "LibraryProvider",
            values: {
                name: "DefaultFilesystemLibraryProvider",
                items: serializeArray(this.items),
            }
        }
    }
}

const QueueItem = class {
    constructor(requester, libraryItem) {
        this.id = -1;
        this.requester = requester;
        this.queue = undefined;
        this.libraryItem = libraryItem;
        this.start = 0;
    }

    toJson() {
        let artwork = this.libraryItem.artwork ? `http://[HOST]:${this.queue.looper.context.port}/art/${this.libraryItem.artwork}` : null;
        return {
            class: "RemoteMedia",
            values: {
                requester: this.requester.id,
                id: this.id,
                title: this.libraryItem.title,
                artist: this.libraryItem.artist,
                artwork: artwork,
                length: this.libraryItem.length,
                progress: this.queue.looper.player.getPosition()
            }
        }
    }
}

const Queue = class {
    constructor(id, looper) {
        this.id = id;
        this.looper = looper;
        this.items = [];
        this.playingIndex = -1;
    }

    get playing() {
        return this.items[this.playingIndex];
    }

    toJson() {
        return {
            class: "Queue",
            values: {
                id: this.id,
                playing: this.playingIndex,
                media: serializeArray(this.items)
            }
        }
    }
}

const QueueLooper = class {
    constructor(player, context) {
        this.player = player;
        this.context = context;
        this.rounds = [];
        this.currentQueuePos = -1;
    }

    enqueue(libraryItem) {
        let queue;
        if (this.rounds.length === 0) {
            queue = new Queue(0, this);
            this.rounds.push(queue);
            this.currentQueuePos = 0;
        } else {
            let r = this.currentQueuePos;
            AL: while (true) {
                if (r >= this.rounds.length) {
                    queue = new Queue(this.rounds.length, this);
                    this.rounds.push(queue);
                } else {
                    queue = this.rounds[r];
                    for (let i = 0; i < queue.items.length; i++) {
                        let a = queue.items[i];
                        if (a.requester.id === libraryItem.requester.id) {
                            r++;
                            continue AL; // member already queued song in this round, move to next
                        }
                    }
                }
                break;
            }
        }

        libraryItem.id = queue.items.length;
        libraryItem.queue = queue;
        queue.items.push(libraryItem);

        if (this.context.playbackState === PLAYBACK_READY) {
            this.skip();
        } else {
            this._broadcastQueueUpdate();
        }
    }
    play() {
        if (this.context.playbackState === PLAYBACK_PAUSED) {
            let q = this.currentQueue;
            if (q) {
                let ref = q.playing;
                if (ref) {
                    ref.start = Date.now() - this.player.getPosition();
                }
            }

            this.player.resume();
            this.context.playbackState = PLAYBACK_PLAYING;

            this._broadcastLobbyUpdate();
        } else if (this.context.playbackState === PLAYBACK_PAUSED) {
            skip();
        } else console.warn("Requested to play queue looper but is already playing");
    }
    pause() {
        this.player.pause();
        this.context.playbackState = PLAYBACK_PAUSED;

        this._broadcastLobbyUpdate();
    }
    skip() {
        if (this.currentQueuePos < 0) {
            console.warn("Requested to skip song but queue looper is empty");
            return;
        }

        this.player.kill();
        this.context.playbackState = PLAYBACK_READY;

        let cq = this.currentQueue;
        let nextId = cq.playingIndex + 1;
        if (nextId >= cq.items.length) { // move to next queue
            this.currentQueuePos++;
            if (this.currentQueuePos < this.rounds.length) {
                cq = this.rounds[this.currentQueuePos];
            } else {
                cq = new Queue(this.currentQueuePos, this);
                this.rounds.push(cq);

                this._broadcastLobbyUpdate();
                return; // next queue is empty, pause playback ;; keep playingIndex at -1
            }
        }
        if ((cq.playingIndex + 1) >= cq.items.length) {
            this._broadcastLobbyUpdate();
            return; // no next song in queue
        }

        let nextSong = cq.items[cq.playingIndex + 1];

        let self = this;
        this.player.play(nextSong.libraryItem.path, function () {
            self.skip();
        });
        this.context.playbackState = PLAYBACK_PLAYING;
        nextSong.start = Date.now();
        cq.playingIndex = nextSong.id;

        console.log(`${new Date()} Now playing: ${nextSong.libraryItem.artist} - ${nextSong.libraryItem.title}`);

        this._broadcastLobbyUpdate();
    }

    get currentQueue() {
        return this.rounds[this.currentQueuePos];
    }

    _broadcastLobbyUpdate() {
        this.context._broadcastEvent("Event.LOBBY_UPDATED", this.context);
        for (let i = 0; i < this.context.listenersUnsafe.length; i++) {
            try {
                this.context.listenersUnsafe[i].onLobbyStateChanged(this.context);
            } catch (e) { }
        }
    }

    _broadcastQueueUpdate() {
        this.context._broadcastEvent("Event.QUEUE_UPDATED", this);
        for (let i = 0; i < this.context.listenersUnsafe.length; i++) {
            try {
                this.context.listenersUnsafe[i].onLooperUpdated(this.context, this);
            } catch (e) { }
        }
    }

    toJson() {
        return {
            class: "QueueLooper",
            values: {
                currentQueue: this.currentQueuePos,
                rounds: serializeArray(this.rounds)
            }
        }
    }
}

const ServerLobby = class {
    constructor(title, port, username, player, listener) {
        let thisLobby = this;

        this.title = title;
        this.port = port;

        this.members = [];
        this.memberCacheByIP = {};
        this.listenersUnsafe = [];
        this.listenersUnsafe.push(listener);
        this.playbackState = PLAYBACK_READY;

        this.memberIdPool = 0;

        this.selfMember = new LobbyMember(username, ++this.memberIdPool, PERMISSION_HOST, "Server", null, this);
        this.members.push(this.selfMember);

        console.log(`${new Date()} Rebuilding library...`);
        this.libraryProvider = new LibraryProvider("./music", this);
        this.libraryProvider.reload().then(function (res) {
            console.log(`${new Date()} Library has been loaded (total ${res.items.length} songs found)`);
            thisLobby._broadcastEvent("Event.LIBRARY_UPDATED", res);
            for (let i = 0; i < thisLobby.listenersUnsafe.length; i++) {
                try {
                    thisLobby.listenersUnsafe[i].onLibraryUpdated(thisLobby, res);
                } catch (e) { }
            }
        }).catch(function (err) {
            console.warn("Failed to reload library:" + err);
        });

        this.looper = new QueueLooper(player, this);

        this.httpServer = http.createServer(function(request, response) {
            response.setHeader("PartyCast-Lobby-Name", title);

            let q = request.url;
            if (q.startsWith("/art/")) {
                let id = decodeURIComponent(q.substring(5));

                let libraryItems = thisLobby.libraryProvider.items;
                for (let i = 0; i < libraryItems.length; i++) {
                    let item = libraryItems[i];
                    if (item.artwork === id) {
                        fs.readFile(".artwork_cache/" + item.artwork, function(error, content) {
                            if (error) {
                                if (error.code === 'ENOENT') {
                                    response.writeHead(404, { 'Content-Type': "text/plain" });
                                    response.end('File not found', 'utf-8');
                                } else {
                                    response.writeHead(500, { 'Content-Type': "text/plain" });
                                    response.end('Sorry, check with the site admin for error: ' + error.code, 'utf-8');
                                }
                            } else {
                                response.writeHead(200, { 'Content-Type': "image/jpeg" });
                                response.end(content, 'utf-8');
                            }
                        });
                        return;
                    }
                }

                response.setHeader("Content-Type", "text/plain");
                response.writeHead(404);
                response.end("Resource not found");
                return;
            }

            response.writeHead(204);
            response.end();
        });
        this.httpServer.listen(port, function() {
            console.log((new Date()) + ' Server is listening on port ' + port);
        });

        this.wsServer = new WebSocketServer({
            httpServer: this.httpServer,
            autoAcceptConnections: false
        });

        this.wsServer.on('request', function(request) {
            var connection = request.accept(null, request.origin);

            let clientAgent = request.httpRequest.headers["user-agent"];
            let clientUsername = request.httpRequest.headers["partycast-username"];
            if (!clientUsername) clientUsername = request.remoteAddress;
            if (!clientUsername) {
                connection.sendUTF("Connect failed: Invalid name provided");
                connection.close(1003, "Invalid name provided");
                return;
            }
            clientUsername = clientUsername.split("\n").join(" ");
            clientUsername = clientUsername.substr(0, 25);

            // todo: change permissions back to default
            // PERMISSIONS_MOD is recommended for debugging,
            // however you should change it back to PERMISSIONS_DEFAULT on production server
            let clientMember = new LobbyMember(clientUsername, ++thisLobby.memberIdPool,
                PERMISSIONS_MOD, clientAgent, connection, thisLobby);

            console.log(`${new Date()} New user with nick \"${clientUsername}\" has been registered with id ${clientMember.id}`);

            // acknowledge existing users before pushing new member to list
            thisLobby._broadcastEvent("Event.USER_JOINED", clientMember);
            thisLobby.members.push(clientMember);

            // push all data to new client
            thisLobby._sendEvent(clientMember, "LobbyCtl.DATA_PUSH", thisLobby);

            for (let i = 0; i < thisLobby.listenersUnsafe.length; i++) {
                try {
                    thisLobby.listenersUnsafe[i].onUserJoined(thisLobby, clientMember);
                } catch (e) { }
            }

            connection.on('message', function(message) {
                if (message.type === 'utf8') {
                    thisLobby._handleMessage(clientMember, connection, message);
                }
            });
            connection.on('close', function(reasonCode, description) {
                console.log(`${new Date()} User \"${clientUsername}\"@${connection.remoteAddress} has been disconnected`);

                if (clientMember) {
                    thisLobby.members = thisLobby.members.filter(function(el) { return el !== clientMember; });
                    thisLobby._broadcastEvent("Event.USER_LEFT", clientMember);

                    for (let i = 0; i < thisLobby.listenersUnsafe.length; i++) {
                        try {
                            thisLobby.listenersUnsafe[i].onUserLeft(thisLobby, clientMember);
                        } catch (e) { }
                    }
                }
            });
        });
    }

    _handleMessage(clientMember, connection, message) {
        try {
            let messageData = JSON.parse(message.utf8Data);
            let eventType = messageData.type;
            let mid = messageData.id || -1;

            if (eventType === 'LobbyCtl.UPDATE_USER') {
                let data = messageData.value;

                if (data.id === clientMember.id && clientMember.checkPermission(PERMISSION_CHANGE_NAME)) {
                    this._handleUsernameChange(clientMember, connection, mid, data);
                } else if (clientMember.checkPermission(PERMISSION_MANAGE_USERS)) {
                    for (let i = 0; i < this.members.length; i++) {
                        let m = this.members[i];
                        if (m.id === Number(data.id)) {
                            this._handleUserUpdate(clientMember, connection, mid, data);
                            break;
                        }
                    }
                } else {
                    connection.sendUTF(JSON.stringify({
                        id: mid,
                        type: "LobbyCtl.RESPONSE",
                        status: -5,
                        message: "Action rejected"
                    }));
                }
            } else if (eventType === 'LobbyCtl.ENQUEUE' && clientMember.checkPermission(PERMISSION_QUEUE)) {
                let data = messageData.value;
                let id = data.id;
                let item = false;

                let libraryItems = this.libraryProvider.items;
                for (let i = 0; i < libraryItems.length; i++) {
                    let a = libraryItems[i];
                    if (a.id === id) {
                        item = a;
                        break;
                    }
                }

                if (item) {
                    this.looper.enqueue(new QueueItem(clientMember, item));
                } else {
                    console.warn("Item \"" + clientMember.name + "\" tried to enqueue was not found");
                    connection.sendUTF(JSON.stringify({
                        id: mid,
                        type: "LobbyCtl.RESPONSE",
                        status: -2,
                        message: "Item not found"
                    }));
                }
            } else if (eventType === 'LobbyCtl.PLAYBACK_PLAY' && clientMember.checkPermission(PERMISSION_MANAGE_QUEUE)) {
                this.looper.play();
            } else if (eventType === 'LobbyCtl.PLAYBACK_PAUSE' && clientMember.checkPermission(PERMISSION_MANAGE_QUEUE)) {
                this.looper.pause();
            } else if (eventType === 'LobbyCtl.PLAYBACK_SKIP' && clientMember.checkPermission(PERMISSION_MANAGE_QUEUE)) {
                this.looper.skip();
            } else {
                console.warn("Unhandled message from " + clientMember.name);
            }
        } catch (e) {
            console.log(e);
            connection.sendUTF(JSON.stringify({
                "type": "Connection.ERROR",
                "data": "Failed to handle message received because error was thrown",
                "clientId": clientMember.id
            }));
        }
    }

    _handleUsernameChange(clientMember, connection, mid, data) {
        clientMember.name = data.name;

        connection.sendUTF(JSON.stringify({
            id: mid,
            type: "LobbyCtl.RESPONSE",
            status: 0,
            message: "Username updated"
        }));
        this._broadcastEvent("Event.USER_UPDATED", clientMember);
        for (let i = 0; i < this.listenersUnsafe.length; i++) {
            try {
                this.listenersUnsafe[i].onUserUpdated(this, clientMember);
            } catch (e) { }
        }
    }

    _handleUserUpdate(clientMember, connection, mid, data) {
        clientMember.name = data.name;
        clientMember.permissions = data.permissions;

        connection.sendUTF(JSON.stringify({
            id: mid,
            type: "LobbyCtl.RESPONSE",
            status: 0,
            message: "Username updated"
        }));
        this._broadcastEvent("Event.USER_UPDATED", clientMember);
        for (let i = 0; i < this.listenersUnsafe.length; i++) {
            try {
                this.listenersUnsafe[i].onUserUpdated(this, clientMember);
            } catch (e) { }
        }
    }

    _broadcastEvent(type, data) {
        for (let i = 0; i < this.members.length; i++) {
            let m = this.members[i];
            this._sendEvent(m, type, data);
        }
    }

    _sendEvent(member, type, data) {
        let conn = member.connection;
        if (conn) {
            try {
                conn.sendUTF(JSON.stringify({
                    "type": type,
                    "data": (typeof data === 'string') ? data : serialize(data),
                    "clientId": member.id
                }));
            } catch (e) {
                console.error(e);
            }
        }
    }

    toJson() {
        return {
            class: "Lobby",
            values: {
                title: this.title,
                hostId: this.selfMember.id,
                members: serializeArray(this.members),
                looper: serialize(this.looper),
                library: serialize(this.libraryProvider),
                playerState: this.playbackState
            }
        }
    }
};

module.exports.LobbyMember = LobbyMember;
module.exports.ServerLobby = ServerLobby;
