import http from 'http';
import path from 'path';
import fs from 'fs';
import express from 'express';
import portfinder from 'portfinder';
import opener from 'opener';
import temp from 'temp';
import mkdirp from 'mkdirp';
import {exec} from 'child_process';
import winston from 'winston';
import prink from 'prink';
import lodash from 'lodash';
import webpack from 'webpack';
import webpackMiddleware from 'webpack-dev-middleware';
import adb from 'adbkit';
import Promise from 'bluebird';
import nomnom from 'nomnom';
import request from 'request-promise-json';

let opts = nomnom
	.option('port', {
		abbr: 'p',
		default: '8080',
		help: 'Port to use'
	})
	.option('open', {
		abbr: 'o',
		default: false,
		flag: true,
		help: 'Open browser after starting the server'
	})
	.option('verbose', {
		abbr: 'v',
		default: false,
		flag: true,
		help: 'Verbose logging'
	})
	.option('adb-path', {
		abbr: 'a',
		help: 'ADB executable [adb in $PATH]'
	})
	.option('b2g-path', {
		abbr: 'b',
		default: path.normalize(path.join(__dirname, '..', 'tools/b2g')),
		help: 'B2G checkout (https://github.com/mozilla-b2g/B2G/)'
	})
	.option('output-path', {
		help: 'Directory for dumping logs, profiles, memory reports, etc. [tmp folder]'
	})
	.option('develop', {
		abbr: 'd',
		default: false,
		flag: true,
		help: 'For developing on Firewatch'
	})
	.parse();

winston.remove(winston.transports.Console)
	.add(winston.transports.Console, {
		level: opts.verbose ? 'info' : 'error'
	});

temp.track();

let sharedPaths = {
	tmp: temp.mkdirSync('devhud')
};
if (opts['output-path']) {
	sharedPaths.output = path.resolve(opts['output-path']);
} else {
	sharedPaths.output = path.join(sharedPaths.tmp, 'output');
}
if (!fs.existsSync(sharedPaths.output)) {
	mkdirp.sync(sharedPaths.output);
}
sharedPaths.output += path.sep;

let staticFolder = path.join(__dirname, 'static');

/**
 * Server setup
 */
let app = express();
if (opts.verbose) {
	app.use(express.logger('dev'));
}

// CORS
app.use(function(req, res, next) {
	res.header('Access-Control-Allow-Origin', '*');
	res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
	res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
	if (req.method == 'OPTIONS') {
		res.send(200);
	}
	next();
});
let subscriptions = [];
let events = [];
let start = 0;

function publishAll(type, data) {
	if (start == 0) {
		start = Date.now();
	}
	data = data || {};
	data.time = Date.now() - start;
	let event = {
		type: type,
		data: data,
		id: events.length
	}
	if (events.length % 100 == 0) {
		console.log('%d events', events.length)
	}
	winston.info(type);
	events.push(event);
	subscriptions.forEach(function(subscription) {
		subscription(event);
	});
}
app.get('/stream', function(req, res) {
	// let request last as long as possible
	req.socket.setTimeout(Infinity);

	let publish = function(event) {
		res.write('id: ' + event.id + '\n');
		res.write('event: ' + event.type + '\n');
		res.write('data: ' + JSON.stringify(event.data) + '\n\n');
	};
	subscriptions.push(publish);

	res.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache',
		'Connection': 'keep-alive'
	});
	res.write('\n');

	// TODO: Recognize Last-Event-ID
	events
		// .slice(-1000)
		.forEach(publish);
	publishAll('ready');

	req.on('close', function() {
		subscriptions.splice(subscriptions.indexOf(publish), 1);
	});
});

app.use(express.static(staticFolder));
app.use('/output', express.static(sharedPaths.output));
app.use(webpackMiddleware(webpack(require('./webpack.config.js')), {
	quiet: false,
	stats: {
		colors: true
	},
	lazy: false,
	noInfo: false
}));

/**
 * Start server
 */
let server = http.createServer(app);

function serverReady() {
	console.log('✓ Remote hud served: http://localhost:%d', opts.port);
	console.log('✎ Output folder: %s', sharedPaths.output);
	if (opts.open) {
		winston.info('Opening browser');
		opener('http://127.0.0.1:' + opts.port);
	}
}

if (!opts.port) {
	portfinder.basePort = 8080;
	portfinder.getPort(function(err, port) {
		if (err) {
			throw err;
		}
		opts.port = port;
		server.listen(port, serverReady);
	});
} else {
	server.listen(opts.port, serverReady);
}

/**
 * ADB magic
 */
let appNames = {};
var supportedEvents = ['appMemory', 'uss'];
let client = adb.createClient();
client.trackDevices()
	.then(function(tracker) {
		tracker.on('add', function(device) {
			winston.log('Device added', device.id);
			publishAll('deviceAdd', {
				id: device.id
			});
			client.openLogcat(device.id, {
				clear: true
			}).then(function(logcat) {
				logcat.excludeAll().include('GeckoDump').on('entry', function(entry) {
					let line = /\[(.+?)\]\s(.+?):\s([^/(]+)(?:\((.+?)\))?/;
					let match = entry.message.match(line);
					if (!match) {
						console.error('Count not parse', entry.message);
						return;
					}
					let [, app, field, value, extra] = match;
					field = lodash.camelCase(field);
					if (supportedEvents.indexOf(field) == -1) {
						return;
					}
					if (value.indexOf('ms') > -1) {
						value = parseInt(value);
					} else {
						value = prink.filesize.parse(value);
					}
					if (extra) {
						extra = extra.split(/,\s+/)
							.map(bits => bits.split(/:\s+/))
							.reduce((values, bits) => {
								values[lodash.camelCase(bits[0])] = prink.filesize.parse(bits[1]);
								return values;
							}, {});
					}
					publishAll(field, {
						app: app,
						value: value,
						extra: extra
					});
					if (!(app in appNames)) {
						if (app.startsWith('http')) {
							appNames[app] = null;
							request.get(app).then((manifest) => {
								publishAll('alias', {
									app: app,
									alias: manifest.name
								});
							}, (err) => {
								console.error(err);
							});
						} else {
							let alias = app.replace(/^app:\/\/|\.gaiamobile.org\/.*$/g, '');
							alias = alias.charAt(0).toUpperCase() + alias.slice(1);
							publishAll('alias', {
								app: app,
								alias: alias
							});
						}
					}
				});
			});
		})
		tracker.on('remove', function(device) {
			winston.log('Device removed', device.id);
			publishAll('deviceRemove', {
				id: device.id
			});
		})
	})
	.catch(function(err) {
		winston.error('Something went wrong:', err);
	});