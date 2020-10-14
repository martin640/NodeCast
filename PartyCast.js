const WebSocketServer = require('websocket').server;
const http = require('http');

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
    for (let i = 0; i < arr.length; i++) {
        ret.push(serialize(arr[i]));
    }
    return ret;
}

const LobbyMember = class {
    constructor(name, id, permissions, agent, connection, lobby) {
        this._name = name;
        this._id = id;
        this._permissions = permissions;
        this._agent = agent;
        this._connection = connection;
        this._lobby = lobby;
    }


    get name() {
        return this._name;
    }

    get id() {
        return this._id;
    }

    get permissions() {
        return this._permissions;
    }

    get agent() {
        return this._agent;
    }

    get connection() {
        return this._connection;
    }

    get lobby() {
        return this._lobby;
    }


    set name(value) {
        this._name = value;
    }

    set permissions(value) {
        this._permissions = value;
    }

    set connection(value) {
        this._connection = value;
    }

    toJson() {
        return {
            class: "LobbyMember",
            values: {
                name: this._name,
                agent: this._agent,
                id: this._id,
                permissions: this._permissions,
                address: (this._connection) ? this._connection.remoteAddress : ""
            }
        }
    }
};

const ServerLobby = class {
    constructor(title, port, username, listener) {
        this.title = title;

        this.members = [];
        this.memberCacheByIP = {};
        this.listenersUnsafe = [];
        this.listenersUnsafe.push(listener);
        this.playbackState = PLAYBACK_READY;

        this.memberIdPool = 0;

        this.selfMember = new LobbyMember(username, ++this.memberIdPool, PERMISSION_HOST, "Server", null, this);
        this.members.push(this.selfMember);

        this.httpServer = http.createServer(function(request, response) {
            response.setHeader("PartyCast-Lobby-Name", title);
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

        let thisLobby = this;

        this.wsServer.on('request', function(request) {
            var connection = request.accept(null, request.origin);
            console.log((new Date()) + ' Connection accepted.');

            let clientAgent = request.httpRequest.headers["user-agent"];
            let clientUsername = request.httpRequest.headers["partycast-username"];
            if (!clientUsername) clientUsername = request.remoteAddress;
            if (!clientUsername) {
                connection.sendUTF("Connect failed: Invalid name provided");
                connection.close(1003, "Invalid name provided");
                return;
            }

            let clientMember = new LobbyMember(clientUsername, ++thisLobby.memberIdPool,
                PERMISSIONS_DEFAULT, clientAgent, connection, thisLobby);

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
                    console.log('Received Message: ' + message.utf8Data);
                    connection.sendUTF(message.utf8Data);
                }
            });
            connection.on('close', function(reasonCode, description) {
                console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.');

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
                e.printStackTrace();
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
                looper: null,
                library: null,
                playerState: this.playbackState
            }
        }
    }
};

module.exports.LobbyMember = LobbyMember;
module.exports.ServerLobby = ServerLobby;
