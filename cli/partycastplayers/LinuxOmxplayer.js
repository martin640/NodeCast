const { spawn, exec } = require('child_process');
const { lookpath } = require('lookpath');
const path = require("path");

/**
 * This is default music player used on Linux-based systems. Requires package 'omxplayer'.
 */
module.exports = class LinuxOmxplayer {
    constructor(volume) {
        this.volume = volume;

        this.playerProcess = undefined;
        this.playing = false;
        this.killed = false;
        this.cachedPosition = 0;
        this.startedTime = 0;
    }

    async checkAvailable() {
        await lookpath('omxplayer');
        return this;
    }

    prepare(lobby) { }

    play(file, endCallback) {
        let absolutePath = path.resolve(file);
        this.playerProcess = spawn("omxplayer", ["-o", "local", "--vol", this.volume, absolutePath]);
        /*this.playerProcess.stdout.on('data', function(data) {
            console.log(data.toString());
        });
        this.playerProcess.stderr.on('data', function(data) {
            console.log(data.toString());
        });*/
        this.playerProcess.stdin.setEncoding('utf-8');
        this.playing = true;
        this.cachedPosition = 0;
        this.startedTime = Date.now();

        let self = this;
        this.playerProcess.on('close', (code) => {
            if (!self.killed) { // avoid firing callback when killed manually
                self.playing = false;
                endCallback();
            } else self.killed = false;
        });
    }
    pause() {
        if (this.playing) {
            this._cacheTime();
            this.playerProcess.stdin.write("p");
            this.playing = false;
        }
    }
    resume() {
        if (!this.playing) {
            this.playerProcess.stdin.write("p");
            this.playing = true;
            this.startedTime = Date.now();
        }
    }
    kill() {
        if (typeof this.playerProcess !== 'undefined') {
            this.killed = true;
            this.playerProcess.stdin.write("q");
            this.playerProcess.stdin.pause();
            this.playerProcess = undefined;
            this.playing = false;
            this.cachedPosition = 0;
            this.startedTime = 0;
        }
    }
    getPosition() {
        if (this.playing) {
            return (Date.now() - this.startedTime) + this.cachedPosition;
        } else return this.cachedPosition;
    }
    isPlaying() {
        return this.playing;
    }

    _cacheTime() {
        this.cachedPosition += (Date.now() - this.startedTime);
    }
}
