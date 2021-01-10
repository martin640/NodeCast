const WebSocketServer = require('websocket').server;
const http = require('http');
const fs = require('fs');
const dgram = require('dgram');
const mm = require('music-metadata');
const path = require("path");

function compactTime() {
    return (new Date()).toLocaleDateString(undefined,
        {
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: '2-digit', second: '2-digit'
        });
}
Number.prototype.roundDecimal = function (precision) {
    let e = Math.pow(10, precision);
    return Math.round((this + Number.EPSILON) * e) / e;
}

const Permissions = {
    PERMISSION_CHANGE_NAME: 1,
    PERMISSION_QUEUE: 2,
    PERMISSION_MEMBER_LIST: 4,
    PERMISSION_MANAGE_USERS: 8,
    PERMISSION_MANAGE_QUEUE: 16,
    PERMISSION_OWNER: 64,
    PERMISSION_HOST: 0b111111111111111111111111111111,
    PERMISSIONS_DEFAULT: this.PERMISSION_CHANGE_NAME | this.PERMISSION_QUEUE | this.PERMISSION_MEMBER_LIST,
    PERMISSIONS_MOD: this.PERMISSIONS_DEFAULT | this.PERMISSION_MANAGE_USERS | this.PERMISSION_MANAGE_QUEUE
}
const LobbyState = {
    STATE_CREATED: 0,
    STATE_CONNECTING: 1,
    STATE_OPEN: 2,
    STATE_CLOSED: 3
}
const PlaybackState = {
    PLAYBACK_READY: 0,
    PLAYBACK_PLAYING: 1,
    PLAYBACK_PAUSED: 2
}
const Utils = {
    parseForExport(obj, extra) {
        if (!extra) extra = {};
        if (Array.isArray(obj)) {
            const ret = [];
            for (let i = 0; i < obj.length; i++) {
                ret.push(Utils.parseForExport(obj[i], extra));
            }
            return ret;
        } else if (typeof obj.export === 'function') {
            return obj.export(extra);
        } else if (extra.allowRaw) { // return raw object if allowed by options
            return obj;
        } else throw Error("parseForExport received plain object: might indicate data leak");
    }
}

/* @deprecated */
function serialize(obj, client, ignoreWarn) {
}
/* @deprecated */
function serializeArray(arr, client) {

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

    export() {
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

    export() {
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
        return new Promise((resolve) => {
            self.items = [];
            let pendingPromises = [];
            fs.readdirSync(self.location).forEach(file => {
                const absPath = self.location + "/" + file;
                fs.mkdirSync(self.context.artworkCacheLocation, { recursive: true })
                pendingPromises.push(new Promise(function (resolve, reject) {
                    mm.parseFile(absPath).then(metadata => {
                        if (Array.isArray(metadata.common.picture) && metadata.common.picture.length > 0) {
                            let cacheLoc = self.context.resolveArtwork(file + ".jpg");
                            if (!fs.existsSync(cacheLoc)) {
                                let picture = metadata.common.picture[0];
                                fs.writeFile(cacheLoc, picture.data, "binary", function(err) { });
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

            return Promise.allSettled(pendingPromises).then(() => {
                self.items = self.items.filter(x => x.title);
                self.items.sort((a, b) => a.title.localeCompare(b.title));
                resolve(self);
            });
        });
    }

    export() {
        return {
            class: "LibraryProvider",
            values: {
                name: "DefaultFilesystemLibraryProvider",
                items: Utils.parseForExport(this.items),
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

    export() {
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
                /* todo check if this item is playing and return correct progress for past/future items
                 *  this is related to bug in android showing same start time for all items */
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

    get next() {
        return this.items[this.playingIndex+1];
    }

    export() {
        return {
            class: "Queue",
            values: {
                id: this.id,
                playing: this.playingIndex,
                media: Utils.parseForExport(this.items)
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

        if (this.context.playbackState === PlaybackState.PLAYBACK_READY) {
            this.skip();
        } else {
            this._broadcastQueueUpdate();
        }
    }
    play() {
        if (this.context.playbackState === PlaybackState.PLAYBACK_PAUSED) {
            let q = this.currentQueue;
            if (q) {
                let ref = q.playing;
                if (ref) {
                    ref.start = Date.now() - this.player.getPosition();
                }
            }

            this.player.resume();
            this.context.playbackState = PlaybackState.PLAYBACK_PLAYING;

            this._broadcastLobbyUpdate();
        } else if (this.context.playbackState === PlaybackState.PLAYBACK_PAUSED) {
            this.skip();
        } else console.warn("Requested to play queue looper but is already playing");
    }
    pause() {
        this.player.pause();
        this.context.playbackState = PlaybackState.PLAYBACK_PAUSED;

        this._broadcastLobbyUpdate();
    }
    skip() {
        if (this.currentQueuePos < 0) {
            console.warn("Requested to skip song but queue looper is empty");
            return;
        }

        this.player.kill();
        this.context.playbackState = PlaybackState.PLAYBACK_READY;

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
        this.context.playbackState = PlaybackState.PLAYBACK_PLAYING;
        nextSong.start = Date.now();
        cq.playingIndex = nextSong.id;

        console.log(`${new Date()} Now playing: ${nextSong.libraryItem.artist} - ${nextSong.libraryItem.title}`);

        this._broadcastLobbyUpdate();
    }

    get currentQueue() {
        return this.rounds[this.currentQueuePos];
    }

    get nowPlaying() {
        let q = this.currentQueue;
        if (q) {
            let ref = q.playing;
            if (ref) {
                return ref;
            }
        }
        return false;
    }
    get upNext() {
        let q = this.rounds[this.currentQueuePos];
        if (q) {
            let ref = q.next;
            if (ref) {
                return ref;
            } else {
                q = this.rounds[this.currentQueuePos+1];
                if (q) return q.next;
                else return false;
            }
        } else return false;
    }

    _broadcastLobbyUpdate() {
        this.context._broadcastEvent("Event.LOBBY_UPDATED", this.context);
        this.context._emitListenersEvent("onLobbyStateChanged");
    }

    _broadcastQueueUpdate() {
        this.context._broadcastEvent("Event.QUEUE_UPDATED", this);
        this.context._emitListenersEvent("onLooperUpdated", this);
    }

    export() {
        return {
            class: "QueueLooper",
            values: {
                currentQueue: this.currentQueuePos,
                rounds: Utils.parseForExport(this.rounds)
            }
        }
    }
}

const ServerLobby = class {
    constructor(config) {
        const thisLobby = this;

        // lobby configuration
        this.title = config.title || "Nodecast Server";
        this.port = config.port || 10784;
        this.libraryLocation = config.libraryLocation || "../Music";
        this.artworkCacheLocation = path.resolve(config.artworkCacheLocation || "../.artwork_cache");
        this.actionBoardProvider = config.actionBoard;
        this.config = config;

        // lobby variables
        this.members = [];
        this.memberCacheByIP = {};
        this.listenersUnsafe = [];
        if (typeof config.listener !== "undefined") {
            this.listenersUnsafe.push(config.listener);
        }
        config.player.prepare(this);
        this.playbackState = PlaybackState.PLAYBACK_READY;
        this.memberIdPool = 0;

        this.selfMember = new LobbyMember(config.username || "Host", ++this.memberIdPool, Permissions.PERMISSION_HOST, "Server", null, this);
        this.members.push(this.selfMember);

        console.log(`[PartyCast @ ${compactTime()}] Rebuilding library... This might take a while`);

        this.libraryProvider = new LibraryProvider(this.libraryLocation, this);
        let buildStart = Date.now();
        this.libraryProvider.reload().then(function (res) {

            let buildTime = (Date.now() - buildStart) / 1000;
            let songsCount = res.items.length;
            let buildSpeed = songsCount / buildTime;
            console.log(`[PartyCast @ ${compactTime()}] Library has been loaded successfully in ${buildTime.roundDecimal(2)} s`);
            console.log(`[PartyCast @ ${compactTime()}] Library contains ${songsCount} songs (average scan speed: ${buildSpeed.roundDecimal(1)} songs/s)`);

            thisLobby._broadcastEvent("Event.LIBRARY_UPDATED", res);
            thisLobby._emitListenersEvent("onLibraryUpdated", res);
        }).catch(function (err) {
            console.warn(`[PartyCast @ ${compactTime()}] Failed to reload library: ${err}`);
        });

        this.looper = new QueueLooper(config.player, this);

        // lobby http server
        this.httpServer = http.createServer(function(request, response) {
            response.setHeader("PartyCast-Lobby-Name", thisLobby.title);

            const q = request.url;
            if (q.startsWith("/art/")) {
                const id = decodeURIComponent(q.substring(5));

                const libraryItems = thisLobby.libraryProvider.items;
                for (let i = 0; i < libraryItems.length; i++) {
                    let item = libraryItems[i];
                    if (item.artwork === id) {
                        let artworkPath = thisLobby.resolveArtwork(item.artwork);
                        fs.readFile(artworkPath, function(error, content) {
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
        this.httpServer.listen(this.port, function() {
            console.log(`[PartyCast @ ${compactTime()}] HTTP server started on port ${thisLobby.port}`);
            thisLobby._emitListenersEvent("onConnected");
        });

        // lobby websocket server
        this.wsServer = new WebSocketServer({
            httpServer: this.httpServer,
            autoAcceptConnections: false
        });

        this.wsServer.on('request', function(request) {
            const connection = request.accept(null, request.origin);

            const clientAgent = request.httpRequest.headers["user-agent"];
            let clientUsername = request.httpRequest.headers["partycast-username"];
            if (!clientUsername) clientUsername = request.remoteAddress;
            if (!clientUsername) {
                connection.sendUTF("Connect failed: Invalid name provided");
                connection.close(1003, "Invalid name provided");
                return;
            }
            clientUsername = clientUsername.split("\n").join(" ");
            clientUsername = clientUsername.substr(0, 25);

            let clientMember = thisLobby.memberCacheByIP[connection.remoteAddress];

            if (clientMember && (clientMember.agent === clientAgent)) {
                clientMember.name = clientUsername;
                clientMember.connection = connection;
                console.log(`[PartyCast @ ${compactTime()}] User \"${clientUsername}\"@${connection.remoteAddress} connected; found cached member by IP address`);
            } else {
                clientMember = new LobbyMember(clientUsername, ++thisLobby.memberIdPool,
                    Permissions.PERMISSIONS_DEFAULT, clientAgent, connection, thisLobby);
                thisLobby.memberCacheByIP[connection.remoteAddress] = clientMember;
                console.log(`[PartyCast @ ${compactTime()}] User \"${clientUsername}\"@${connection.remoteAddress} connected; assigned new ID ${clientMember.id}`);
            }

            if (thisLobby.actionBoardProvider) {
                clientMember.board = thisLobby.actionBoardProvider(clientMember, () => {
                    thisLobby._sendEvent(clientMember, "Event.BOARD_UPDATED", {data: clientMember.board.generate()});
                })
            }


            // acknowledge existing users before pushing new member to list
            thisLobby._broadcastEvent("Event.USER_JOINED", clientMember);
            thisLobby.members.push(clientMember);

            // push all data to new client
            thisLobby._sendEvent(clientMember, "LobbyCtl.DATA_PUSH", thisLobby);
            thisLobby._emitListenersEvent("onUserJoined", clientMember);

            connection.on('message', function(message) {
                if (message.type === 'utf8') {
                    thisLobby._handleMessage(clientMember, connection, message);
                }
            });
            connection.on('close', function(reasonCode, description) {
                console.log(`[PartyCast @ ${compactTime()}] User \"${clientUsername}\"@${connection.remoteAddress} has disconnected: [code ${reasonCode}] ${description}`);

                if (clientMember) {
                    thisLobby.members = thisLobby.members.filter(function(el) { return el !== clientMember; });
                    thisLobby._broadcastEvent("Event.USER_LEFT", clientMember);
                    thisLobby._emitListenersEvent("onUserLeft", clientMember);
                }
            });
        });

        // lobby udp multicast client
        let udpSocket = (this.udpSocket = dgram.createSocket('udp4'));
        this.udpSocket.on('listening', function () {
            console.log(`[PartyCast @ ${compactTime()}] UDP multicast client started on port ${thisLobby.port}`);
            udpSocket.setBroadcast(true)
            udpSocket.setMulticastTTL(128);
            udpSocket.addMembership('224.1.1.1');
        });
        this.udpSocket.on('message', function (message, remote) {
            udpSocket.send(thisLobby.title, 0, thisLobby.title.length, remote.port, remote.address);
        });
        this.udpSocket.bind(this.port);
    }

    _handleMessage(clientMember, connection, message) {
        try {
            const messageData = JSON.parse(message.utf8Data);
            const eventType = messageData.type;
            const mid = messageData.id || -1;

            if (eventType === 'ActionBoard.SUBMIT') {
                const data = messageData.value;
                if (clientMember.board) {
                    try {
                        const res = clientMember.board.handleInput(data.id, data.value);
                        connection.sendUTF(JSON.stringify({
                            id: mid,
                            type: "LobbyCtl.RESPONSE",
                            status: 0,
                            message: res
                        }));
                    } catch (e) {
                        connection.sendUTF(JSON.stringify({
                            id: mid,
                            type: "LobbyCtl.RESPONSE",
                            status: -21,
                            message: e.toString()
                        }));
                    }
                } else {
                    connection.sendUTF(JSON.stringify({
                        id: mid,
                        type: "LobbyCtl.RESPONSE",
                        status: -5,
                        message: "Action rejected"
                    }));
                }
            } else if (eventType === 'LobbyCtl.UPDATE_USER') {
                const data = messageData.value;

                if (clientMember.checkPermission(Permissions.PERMISSION_MANAGE_USERS)) {
                    for (let i = 0; i < this.members.length; i++) {
                        const m = this.members[i];
                        if (m.id === Number(data.id)) {
                            this._handleUserUpdate(m, connection, mid, data);
                            break;
                        }
                    }
                } else if (data.id === clientMember.id && clientMember.checkPermission(Permissions.PERMISSION_CHANGE_NAME)) {
                    this._handleUsernameChange(clientMember, connection, mid, data);
                } else {
                    connection.sendUTF(JSON.stringify({
                        id: mid,
                        type: "LobbyCtl.RESPONSE",
                        status: -5,
                        message: "Action rejected"
                    }));
                }
            } else if (eventType === 'LobbyCtl.ENQUEUE' && clientMember.checkPermission(Permissions.PERMISSION_QUEUE)) {
                const data = messageData.value;
                const id = data.id;
                if (this._enqueueById(clientMember, id)) {
                    connection.sendUTF(JSON.stringify({
                        id: mid,
                        type: "LobbyCtl.RESPONSE",
                        status: 0,
                        message: "OK"
                    }));
                } else {
                    connection.sendUTF(JSON.stringify({
                        id: mid,
                        type: "LobbyCtl.RESPONSE",
                        status: -2,
                        message: "Item not found"
                    }));
                }
            } else if (eventType === 'LobbyCtl.PLAYBACK_PLAY' && clientMember.checkPermission(Permissions.PERMISSION_MANAGE_QUEUE)) {
                this.looper.play();
            } else if (eventType === 'LobbyCtl.PLAYBACK_PAUSE' && clientMember.checkPermission(Permissions.PERMISSION_MANAGE_QUEUE)) {
                this.looper.pause();
            } else if (eventType === 'LobbyCtl.PLAYBACK_SKIP' && clientMember.checkPermission(Permissions.PERMISSION_MANAGE_QUEUE)) {
                this.looper.skip();
            } else if (eventType === 'LobbyCtl.VOLUME_UPDATE' && clientMember.checkPermission(Permissions.PERMISSION_MANAGE_QUEUE)) {
                const data = messageData.value;
                const {level, muted} = data;
                const volumeControl = this.config.player.getVolumeControl();
                if (!volumeControl) {
                    return connection.sendUTF(JSON.stringify({
                        id: mid,
                        type: "LobbyCtl.RESPONSE",
                        status: -1,
                        message: "Not supported"
                    }));
                }

                volumeControl.setLevel(level);
                volumeControl.setMuted(muted);

                const newTmpState = { level, muted };
                this._broadcastEvent("Event.VOLUME_UPDATED", newTmpState);
            } else {
                connection.sendUTF(JSON.stringify({
                    id: mid,
                    type: "LobbyCtl.RESPONSE",
                    status: -1,
                    message: "Not supported"
                }));
            }
        } catch (e) {
            console.error(`[PartyCast @ ${compactTime()}] Error thrown while trying to handle message: ${e}`);
            connection.sendUTF(JSON.stringify({
                type: "Connection.ERROR",
                data: "Failed to handle message received because error was thrown",
                clientId: clientMember.id
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
        this._emitListenersEvent("onUserUpdated", clientMember);
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
        this._emitListenersEvent("onUserUpdated", clientMember);
    }

    _emitListenersEvent(event, ...args) {
        const listenersCopy = [...this.listenersUnsafe];
        for (let i = 0; i < listenersCopy.length; i++) {
            try {
                listenersCopy[i][event](this, ...args);
            } catch (e) { }
        }
    }

    _broadcastEvent(type, data) {
        for (let i = 0; i < this.members.length; i++) {
            let m = this.members[i];
            this._sendEvent(m, type, (typeof data === 'function') ? data(m) : data);
        }
    }

    _sendEvent(member, type, data) {
        let conn = member.connection;
        if (conn) {
            try {
                conn.sendUTF(JSON.stringify({
                    "type": type,
                    "data": (typeof data === 'string') ? data : Utils.parseForExport(data, {member, allowRaw: true}),
                    "clientId": member.id
                }));
            } catch (e) {
                console.error(`[PartyCast] Error thrown while trying to send event data to client: ${e}`);
            }
        }
    }

    _enqueueById(clientMember, id) {
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
            return true;
        } else {
            return false;
        }
    }

    resolveArtwork(artworkUri) {
        return path.resolve(`${this.artworkCacheLocation}/${artworkUri}`);
    }

    export(extra) {
        const volumeControl = this.config.player.getVolumeControl();
        const member = extra.member;
        return {
            class: "Lobby",
            values: {
                title: this.title,
                hostId: this.selfMember.id,
                members: Utils.parseForExport(this.members, extra),
                looper: Utils.parseForExport(this.looper, extra),
                library: Utils.parseForExport(this.libraryProvider, extra),
                playerState: this.playbackState,
                volumeState: {
                    level: volumeControl.level,
                    muted: volumeControl.muted
                },
                actionBoard: member.board ? member.board.generate() : []
            }
        }
    }
};

module.exports.compactTime = compactTime;
module.exports.LobbyMember = LobbyMember;
module.exports.ServerLobby = ServerLobby;
module.exports.Permissions = Permissions;
module.exports.LobbyState = LobbyState;
module.exports.PlaybackState = PlaybackState;
