var Pushbullet = require('pushbullet');
var Milight = require('node-milight-promise').MilightController;
var Commands = require('node-milight-promise').commands;
var Promise = require('bluebird');
var readFile = Promise.promisify(require('fs').readFile);
var argv = require('optimist')
    .usage('Usage: $0 -p [apikey] -m [ipaddr]')
    .demand(['p', 'm'])
    .alias('p', 'pushbullet')
    .alias('m', 'milight')
    .alias('g', 'group')
    .alias('s', 'start-hour')
    .alias('e', 'end-hour')
    .alias('f', 'state-file')
    .alias('r', 'grace-period')
    .alias('c', 'color')
    .describe('p', 'Pushbullet API key')
    .describe('m', 'Milight IP address')
    .describe('g', 'Milight group')
    .describe('s', 'Enabled only after this hour')
    .describe('e', 'Enabled only before this hour')
    .describe('f', 'State file location (0 - enabled, 1 - disabled) see https://github.com/noamshemesh/motion-starter')
    .describe('r', 'How many seconds to wait after one blink')
    .describe('c', 'Color (0-256) 0 is purple, 27 is red, 186 is blue. Counter-clockwise of the color pallete on your remote')
    .argv;

var apiKey = argv.p;
var ipAddress = argv.m;
var group = argv.g;
var startsAt = argv.s;
var endsAt = argv.e;
var fileLocation = argv.f;
var gracePeriod = argv.r;

var milight = new Milight({
        ip: ipAddress,
        delayBetweenCommands: 35,
        commandRepeat: 3
    });
var pushbullet = new Pushbullet(apiKey);
var stream = pushbullet.stream();
var isOpen = false;
var lastTime = +new Date() - gracePeriod * 1000 - 1;

stream.connect();

stream.once('connect', function () {
  isOpen = true;
  console.log('Connected to pushbullet');
});

stream.once('close', function () {
  isOpen = false;
  console.log('Disconnected from pushbullet');
});

stream.once('error', function (err) {
  console.log('Error from pushbullet', err);
  isOpen && stream.close();
  process.exit(1);
});

stream.on('push', function (data) {
  if (data.type == 'dismissal') {
    return;
  }

  var hoursNow = new Date().getHours();
  var enabled = true;
  var promise = Promise.resolve();

  if ((startsAt && hoursNow < startsAt) || (endsAt && hoursNow > endsAt)) {
    enabled = false;
  }

  if (enabled && gracePeriod && +new Date() - lastTime <= gracePeriod * 1000) {
    enabled = false;
  } else {
    lastTime = +new Date();
  }

  if (enabled && fileLocation) {
    promise = promise.then(function () { return readFile(fileLocation, { encoding: 'utf-8' }) }).then(function (data) {
      enabled = !parseInt(data.replace(/(\r\n|\n|\r)/gm,'').trim());
    });
  }
  promise.then(function () {
    if (!enabled) {
      return;
    }

    var color = argv.c; // white
    if (color && data.application_name) {
      var lcAppName = data.application_name.toLowerCase();
      if (lcAppName.indexOf('inbox') >= 0) {
        color -= 30;
        color += color < 0 ? 256 : 0;
      } else if (lcAppName.indexOf('whatsapp') >= 0) {
        color = (color + 30) % 255;
      }
    }

    milight.sendCommands(Commands.rgbw.on(group), Commands.rgbw.brightness(20));
    color && milight.pause(500);
    color && milight.sendCommands(Commands.rgbw.hue(color));
    color && milight.sendCommands(Commands.rgbw.brightness(10));
    color && milight.sendCommands(Commands.rgbw.brightness(100));
    milight.pause(250);
    color && milight.sendCommands(Commands.rgbw.brightness(10));
    color && milight.pause(500);
    color && milight.sendCommands(Commands.rgbw.whiteMode(group));
    milight.sendCommands(Commands.rgbw.brightness(100));
  });
});
