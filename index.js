const { ServerLobby } = require("./PartyCast");

const lobby = new ServerLobby("Nodecast 1.0", "10784", "Nodecast", {
    onUserJoined: function (l, m) {
    }
});
