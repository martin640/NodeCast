const {ServerLobby, compactTime, PlaybackState} = require("../../PartyCast")
const DiscordRPC = require('discord-rpc')
const packageInfo = require('../../package.json')
const configJson = require('../../partycast.json') || {}
const fallbackConfig = configJson.disable_example_as_fallback ? {} : (require('../../partycast.example.json') || {})

const clientId = '790227124597948436'
DiscordRPC.register(clientId)
const rpc = new DiscordRPC.Client({transport: 'ipc'})

const controller = {
    name: "ElectronDocumentController",
    lobby: undefined,
    audio: undefined,
    playing: false,
    killed: false,

    checkAvailable: function () {
        return Promise.resolve(this)
    },
    prepare: function (lobby) {
        this.lobby = lobby
    },
    play: function (file, callback) {
        this.audio = new Audio(file);
        this.audio.play();
        this.playing = true;
        let self = this;
        this.audio.addEventListener('pause', () => {
            if (!this.audio.ignoreEvents) {
                console.log("Received pause event from unknown source");
                this.playing = false;
                this.lobby.playbackState = PlaybackState.PLAYBACK_PAUSED;
                this.lobby.looper._broadcastLobbyUpdate();
            }
            this.audio.ignoreEvents = false; // clear flag
        });
        this.audio.addEventListener('play', () => {
            console.log("Received play event from unknown source");
            if (!this.audio.ignoreEvents) {
                this.playing = true;
                this.lobby.playbackState = PlaybackState.PLAYBACK_PLAYING;
                this.lobby.looper._broadcastLobbyUpdate();
            }
            this.audio.ignoreEvents = false; // clear flag
        });
        this.audio.addEventListener('ended', () => {
            if (!self.killed) {
                self.playing = false;
                callback();
            } else self.killed = false;
        });
    },
    pause: function () {
        if (this.playing) {
            this.audio.ignoreEvents = true;
            this.audio.pause();
            this.playing = false;
        }
    },
    resume: function () {
        if (typeof this.audio !== 'undefined') {
            this.audio.ignoreEvents = true;
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
    isPlaying: function () {
        return this.playing
    }
}

const DataContext = React.createContext({})

class DataProvider extends React.Component {
    state = {
        loadingLobby: true, loadingLibrary: true,
        skip: () => this.state.lobby.looper.skip()
    }
    update() {
        this.setState(this.state)
    }

    componentDidMount() {
        const config = {
            title: configJson.party_title || fallbackConfig.party_title,
            serverPort: configJson.ws_port || fallbackConfig.ws_port,
            username: configJson.party_host_username || fallbackConfig.party_host_username,
            player: controller,
            libraryLocation: configJson.music_src || fallbackConfig.music_src,
            artworkCacheLocation: configJson.music_artwork_cache_src || fallbackConfig.music_artwork_cache_src,
            listener: {
                onConnected: (lobby) => {
                    if (this.state.loadingLobby) this.setState({loadingLobby: false})
                    else this.update()

                    this.proxyListeners.forEach(x => x.onConnected && x.onConnected(lobby))
                },
                onUserJoined: () => this.update(),
                onUserLeft: () => this.update(),
                onUserUpdated: () => this.update(),
                onDisconnect: () => this.update(),
                onError: () => this.update(),
                onLobbyStateChanged: () => this.update(),
                onLooperUpdated: () => this.update(),
                onLibraryUpdated: () => {
                    if (this.state.loadingLibrary) this.setState({loadingLibrary: false})
                    else this.update()
                }
            }
        }

        const lobby = new ServerLobby(config)
        this.setState({lobby})
    }

    render() {
        if (this.state.loadingLobby) {
            return <p style={{margin: 16}}>Initializing server...</p>
        } else {
            return <DataContext.Provider value={this.state} {...this.props} />
        }
    }
}

function Sidebar() {
    const data = React.useContext(DataContext)

    const kick = (val) => val.connection.close(4000, "You've been kicked from the session")

    return (
        <React.Fragment>
            <h3>{data.lobby.title}</h3>
            <div id="app-server-members-list">
                <small className="heading">Connected users:</small>
                {data.lobby.members.filter(x => x.id > 1).map(val => (
                    <p key={val.id} onClick={() => kick(val)} title="Click to kick user">
                        <span>{val.name}</span>
                        <br/>
                        <small>{val.connection?.remoteAddress}</small>
                    </p>
                ))}
            </div>
        </React.Fragment>
    )
}

function LibraryView() {
    const data = React.useContext(DataContext)

    const enqueue = (row) => {
        let id = row.id;
        if (!data.lobby._enqueueById(data.lobby.selfMember, id)) {
            console.warn(`[${compactTime()}] Enqueue item failed: ${id} not found`);
            alert("Item not found in library");
        }
    }

    if (data.loadingLibrary) {
        return <p style={{margin: 16}}>Loading library... This might take a while</p>
    } else {
        const libraryItems = data.lobby.libraryProvider.items
        return (
            <React.Fragment>
                {libraryItems.map(val => (
                    <div className="library-element" key={val.id} onClick={() => enqueue(val)}>
                        <img src={`${data.lobby.artworkCacheLocation}/${val.artwork}`} alt="Song artwork"/>
                        <div className="flex vertical center">
                            {val.title}<br/>{val.artist}
                        </div>
                    </div>
                ))}
            </React.Fragment>
        )
    }
}

function ProgressBar(props) {
    const {controller, max, progress, ...otherProps} = props
    const [progressReal, setProgress] = React.useState(progress || 0)

    React.useEffect(() => {
        const id = setInterval(() => {
            //let nowPlayingProgressbarWidth = nowPlayingProgressbar.clientWidth
            setProgress(controller.getPosition() / max * 100)
        }, 1000 / 120)

        return () => clearInterval(id)
    }, [progress, controller, max])

    return (
        <div className="now-playing-progressbar" {...otherProps}>
            <div className="now-playing-progressbar-value" style={{width: progressReal + "%"}}>
            </div>
        </div>
    )
}

function ProgressTextView(props) {
    const [formatted, setFormatted] = React.useState("--:--")
    const {time, start, end, ...otherProps} = props

    React.useEffect(() => {
        const id = setInterval(() => {
            let millis = time
            if (start) {
                millis = Date.now() - start
            } else if (end) {
                millis = end - Date.now()
            }

            if (!isNaN(millis)) {
                const minutes = Math.floor(millis / 60000)
                const seconds = Math.floor((millis % 60000) / 1000)
                setFormatted(`${minutes}:${seconds > 9 ? seconds : ("0" + seconds)}`)
            } else setFormatted("--:--")
        }, 1000 / 120)

        return () => clearInterval(id)
    }, [time, start, end])

    return <small {...otherProps}>{formatted}</small>
}

function MiniPlayer() {
    const data = React.useContext(DataContext)

    let artworkSrc = 'error.svg',
        title = '', artist = '', length = 0, start,
        controlPlayD = 'M8,5.14V19.14L19,12.14L8,5.14Z',
        controlPlayA = () => {},
        controlSkipA = () => data.lobby.looper.skip(),
        nowPlaying, nextRef

    if (data.lobby.playbackState === PlaybackState.PLAYBACK_READY) {
        rpc.setActivity({
            largeImageKey: 'idle',
            largeImageText: 'Idle',
            instance: false,
        }).catch(() => {})
    } else {
        const isPlaying = data.lobby.playbackState === PlaybackState.PLAYBACK_PLAYING
        controlPlayD = isPlaying ? 'M14,19H18V5H14M6,19H10V5H6V19Z' : 'M8,5.14V19.14L19,12.14L8,5.14Z'
        controlPlayA = isPlaying ? () => data.lobby.looper.pause() : () => data.lobby.looper.play()

        nowPlaying = data.lobby.looper.nowPlaying
        if (nowPlaying) {
            artworkSrc =  `${data.lobby.artworkCacheLocation}/${nowPlaying.libraryItem.artwork}`
            title = nowPlaying.libraryItem.title
            artist = nowPlaying.libraryItem.artist
            length = nowPlaying.libraryItem.length
            start = isPlaying ? (Date.now() - controller.getPosition()) : undefined

            rpc.setActivity({
                details: title,
                state: `by ${artist}`,
                startTimestamp: start,
                largeImageKey: 'main_icon',
                largeImageText: `${packageInfo.name} ${packageInfo.version}`,
                smallImageKey: isPlaying ? 'play' : 'pause',
                smallImageText: isPlaying ? 'Playing' : 'Paused',
                instance: false,
            }).catch(() => {})
        } else {
            console.warn(`[${compactTime()}] Lobby playback state is not PLAYBACK_READY but no currently playing media is found.`)
        }

        nextRef = data.lobby.looper.upNext
    }

    return (
        <React.Fragment>
            <ProgressBar controller={controller} max={length}/>
            <div className="now-playing">
                <div className="now-playing-left">
                    <img id="now-playing-image" src={artworkSrc} alt="Now Playing artwork"/>
                </div>
                <div className="now-playing-right flex vertical center">
                    <h4 id="now-playing-title">{title}</h4>
                    <span id="now-playing-artist">{artist}</span>
                </div>
            </div>
            <div className="now-playing-controls">
                <ProgressTextView start={start} className="flex center-all" style={{marginRight: 24, color: "#ffffff77"}}/>
                <div className="now-playing-control-item flex center-all" onClick={controlPlayA}>
                    <svg style={{width: 24, height: 24}} viewBox="0 0 24 24">
                        <path fill="currentColor" d={controlPlayD}/>
                    </svg>
                </div>
                <div className="now-playing-control-item flex center-all" onClick={controlSkipA}>
                    <svg style={{width: 24, height: 24}} viewBox="0 0 24 24">
                        <path fill="currentColor" d="M16,18H18V6H16M6,18L14.5,12L6,6V18Z"/>
                    </svg>
                </div>
                <ProgressTextView time={length} className="flex center-all" style={{marginLeft: 24, color: "#ffffff77"}}/>
            </div>
            <div className="now-playing-up-next" style={{opacity: nextRef ? 1 : 0}}>
                <div className="up-next-left flex vertical center">
                    <small style={{fontSize: "0.8em", opacity: "0.5"}}>Up next:</small>
                    <h4 id="up-next-title">{nextRef?.libraryItem?.title}</h4>
                    <span id="up-next-artist">{nextRef?.libraryItem?.artist}</span>
                </div>
                <div className="up-next-right">
                    <img id="up-next-image" alt="Next up artwork"
                         src={nextRef ?`${data.lobby.artworkCacheLocation}/${nextRef.libraryItem.artwork}` : "error.svg"}/>
                </div>
            </div>
        </React.Fragment>
    )
}

const init = () => {
    ReactDOM.render((
        <DataProvider>
            <div className="root-wrapper">
                <div className="panel-left">
                    <Sidebar/>
                </div>
                <div className="content-middle">
                    <LibraryView/>
                </div>
                <div className="panel-bottom">
                    <MiniPlayer/>
                </div>
            </div>
        </DataProvider>
    ), document.getElementById('root'))
}
rpc.on('ready', () => {})
rpc.login({clientId}).then(init).catch((err) => {
    console.error(err)
    init()
})
