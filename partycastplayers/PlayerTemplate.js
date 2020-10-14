/**
 * This is template for other music players.
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
    isPlaying() { }
}
