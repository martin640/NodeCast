# NodeCast

<img src="screenshot.png">
NodeCast is NodeJS implementation of PartyCast server allowing it to be run on embedded devices.

In order to run project "as is" without modifications, you will need:
  1. Linux system
  2. 'omxplayer' package (debian: `sudo apt install omxplayer`, arch: `sudo pacman -S omxplayer`)
  3. nodejs(10+) and npm
  4. Create `music` folder and put your music there
  5. Run `npm start`

Alternatively create your own music player controller by following <a href="partycastplayers/PlayerTemplate.js">partycastplayers/PlayerTemplate.js</a> and changing index.js server initialization
```
const lobby = new ServerLobby(SERVER_PARTY_TITLE, SERVER_PORT, SERVER_USERNAME, /* YOUR MUSIC PLAYER CONTROLLER CONSTRUCTOR */, {
```
