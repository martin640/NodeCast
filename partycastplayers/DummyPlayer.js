module.exports = {
    name: "DummyPlayer",
    playing: false,
    killed: false,

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
    isPlaying: function () { return this.playing }
}
