const { spawn, exec } = require('child_process');
const path = require("path");

module.exports = class {
    constructor(volume) {
        this.volume = volume;

        this.playerProcess = undefined;
        this.playing = false;
        this.cachedPosition = 0;
        this.startedTime = 0;
    }

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
        this.startedTime = Date.now();

        let self = this;
        this.playerProcess.on('close', (code) => {
            self.playing = false;
            endCallback();
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
        if (this.playing) {
            this.playerProcess.kill();
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