/**
 * This is template for other music players.
 * Constructor is not called by internal functions so it can contain custom arguments.
 * For example, default LinuxOmxplayer.js requires volume as argument, which is then passed to called processes.
 */
module.exports = class {
    constructor() {
        this.playing = false;
    }

    play(file, endCallback) {
        // open and play media file, endCallback should be called when playback ends
    }

    pause() {
        // pause if playback is started
    }

    resume() {
        // resume if playback is paused
    }

    kill() {
        // this function is used to reset music player to initial state
    }

    getPosition() {
        // return playback progress in milliseconds
    }

    isPlaying() {
        return this.playing
    }
}
