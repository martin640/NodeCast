const { ServerLobby, compactTime, PlaybackState } = require("../../PartyCast")

console.log(`[${compactTime()}] Initializing Nodecast with UI...`);

// config vars
const SERVER_PORT = "10784";
const SERVER_PARTY_TITLE = "Nodecast " + process.env.npm_package_version;
const SERVER_USERNAME = "Nodecast";

let controller = {
    name: "ElectronDocumentController",
    lobby: undefined,
    audio: undefined,
    playing: false,
    killed: false,

    checkAvailable: function () { return Promise.resolve(this) },
    prepare: function (lobby) { this.lobby = lobby },
    play: function (file, callback) {
        this.audio = new Audio(file);
        this.audio.play();
        this.playing = true;
        let self = this;
        this.audio.addEventListener('ended', (event) => {
            if (!self.killed) {
                self.playing = false;
                callback();
            } else self.killed = false;
        });
    },
    pause: function () {
        if (this.playing) {
            this.audio.pause();
            this.playing = false;
        }
    },
    resume: function () {
        if (typeof this.audio !== 'undefined') {
            this.audio.play();
            this.playing = true;
        }
    },
    kill: function () {
        this.pause();
    },
    getPosition: function () {
        if (typeof this.audio !== 'undefined') return Math.round(this.audio.currentTime * 1000);
        else return 0;
    },
    isPlaying: function () { return this.playing }
}

function updateNowPlaying(lobby, looper) {
    let nowPlayingArtwork = document.getElementById("now-playing-image");
    let nowPlayingTitle = document.getElementById("now-playing-title");
    let nowPlayingArtist = document.getElementById("now-playing-artist");

    let nowPlayingControlPlay = document.getElementById("now-playing-control-play");

    let nextUp = document.querySelector(".now-playing-up-next");
    let nextUpArtwork = document.getElementById("up-next-image");
    let nextUpTitle = document.getElementById("up-next-title");
    let nextUpArtist = document.getElementById("up-next-artist");

    nowPlayingArtwork.onerror = function() {
        nowPlayingArtwork.src = 'error.svg';
    };

    if (lobby.playbackState === PlaybackState.PLAYBACK_READY) {
        nowPlayingArtwork.src = nowPlayingTitle.innerText = nowPlayingArtist.innerText = '';
    } else {
        if (lobby.playbackState === PlaybackState.PLAYBACK_PLAYING) {
            nowPlayingControlPlay.querySelector("path").setAttribute("d","M14,19H18V5H14M6,19H10V5H6V19Z");
            nowPlayingControlPlay.onclick = function () {
                lobby.looper.pause();
            };
        } else {
            nowPlayingControlPlay.querySelector("path").setAttribute("d","M8,5.14V19.14L19,12.14L8,5.14Z");
            nowPlayingControlPlay.onclick = function () {
                lobby.looper.play();
            };
        }

        let ref = looper.nowPlaying;
        if (ref) {
            nowPlayingArtwork.src = `${lobby.artworkCacheLocation}/${ref.libraryItem.artwork}`;
            nowPlayingTitle.innerText = ref.libraryItem.title;
            nowPlayingArtist.innerText = ref.libraryItem.artist;
        } else {
            console.warn(`[${compactTime()}] Lobby playback state is not PLAYBACK_READY but no currently playing media is found.`);
            nowPlayingArtwork.src = nowPlayingTitle.innerText = nowPlayingArtist.innerText = '';
        }

        let nextRef = looper.upNext;
        if (nextRef) {
            nextUp.style.opacity = 1;
            nextUpArtwork.src = `${lobby.artworkCacheLocation}/${nextRef.libraryItem.artwork}`;
            nextUpTitle.innerText = nextRef.libraryItem.title;
            nextUpArtist.innerText = nextRef.libraryItem.artist;
        } else {
            nextUp.style.opacity = 0;
        }
    }
}

let config = {
    title: SERVER_PARTY_TITLE,
    serverPort: SERVER_PORT,
    username: SERVER_USERNAME,
    player: controller,
    libraryLocation: "D:/Music",
    artworkCacheLocation: "D:/Music/.artwork_cache",
    listener: {
        onConnected: function(lobby) {
            document.getElementById("app-server-title").textContent = lobby.title;
        },
        onUserJoined: function (lobby, member) {
            let membersList = document.getElementById("app-server-members-list");
            let li = document.createElement("p");
            li.setAttribute("id", member.id);
            li.appendChild(document.createTextNode(member.name));
            li.appendChild(document.createElement("br"));
            let liOrigin = document.createElement("small");
            liOrigin.innerText = member.connection.remoteAddress;
            li.appendChild(liOrigin);
            li.onclick = function () {
                // test kicking
                member.connection.close(4000, "You has been kicked from session");
            };
            li.title = "Click to kick user";

            membersList.appendChild(li);
        },
        onUserLeft: function (lobby, member) {
            document.querySelector(`#app-server-members-list p[id='${member.id}']`).remove();
        },
        onUserUpdated: function (lobby, member) {
            let li = document.querySelector(`#app-server-members-list p[id='${member.id}']`);
            li.innerHTML = '';

            li.appendChild(document.createTextNode(member.name));
            li.appendChild(document.createElement("br"));
            let liOrigin = document.createElement("small");
            liOrigin.innerText = member.connection.remoteAddress;
            li.appendChild(liOrigin);
        },
        onDisconnect: function (lobby, code, reason) { },
        onError: function (lobby, error) { },
        onLobbyStateChanged: function (lobby) {
            updateNowPlaying(lobby, lobby.looper);
        },
        onLooperUpdated: function (lobby, looper) {
            updateNowPlaying(lobby, looper);
        },
        onLibraryUpdated: function (lobby, libraryProvider) {
            let library = document.getElementById("app-library-list");
            library.innerHTML = '';
            let libraryItems = libraryProvider.items;
            for (let i = 0; i < libraryItems.length; i++) {
                let libraryItemRow = libraryItems[i];

                let newItem = document.createElement("div");
                newItem.className = "library-element";
                newItem.setAttribute("id", libraryItemRow.id);

                let newItemArtwork = document.createElement("img");
                newItemArtwork.onerror = function() {
                    newItemArtwork.src = 'error.svg';
                };
                newItemArtwork.src = `${lobby.artworkCacheLocation}/${libraryItemRow.artwork}`;
                newItem.appendChild(newItemArtwork);

                let newItemInfo = document.createElement("div");
                newItemInfo.appendChild(document.createTextNode(libraryItemRow.title));
                newItemInfo.appendChild(document.createElement("br"));
                newItemInfo.appendChild(document.createTextNode(libraryItemRow.artist));
                newItem.appendChild(newItemInfo);

                newItem.onclick = function () {
                    let id = libraryItemRow.id;
                    if (!lobby._enqueueById(lobby.selfMember, id)) {
                        console.warn(`[${compactTime()}] Enqueue item failed: ${id} not found`);
                        alert("Item not found in library");
                    }
                };

                library.appendChild(newItem);
            }
        }
    }
};

let lobby = new ServerLobby(config);

let nowPlayingControlSkip = document.getElementById("now-playing-control-skip");
nowPlayingControlSkip.onclick = () => lobby.looper.skip();

const nowPlayingProgressbar = document.querySelector(".now-playing-progressbar");
const nowPlayingProgressbarValue = document.querySelector(".now-playing-progressbar-value");
const lobbyLooper = lobby.looper;
const updatesInterval = 1000 / 120; // 120 FPS
setInterval(() => {
    let nowPlayingProgressbarWidth = nowPlayingProgressbar.clientWidth;
    let q = lobbyLooper.currentQueue;
    if (q) {
        let ref = q.playing;
        if (ref) {
            let progress = controller.getPosition() / ref.libraryItem.length;
            nowPlayingProgressbarValue.style.width = (progress * nowPlayingProgressbarWidth) + "px";
            return;
        }
    }

    nowPlayingProgressbarValue.style.width = "0";
}, updatesInterval);
