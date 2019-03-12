/**
 *      iobroker bmw Adapter
 *      (c) 2016- <frankjoke@hotmail.com>
 *      MIT License
 */
// jshint node:true, esversion:6, strict:true, undef:true, unused:true
"use strict";
const
	//	utils = require('./lib/utils'),
	//	adapter = utils.Adapter('broadlink2'),
	Broadlink = require('./broadlink_fj'),
	dns = require('dns'),
	assert = require('assert'),
    A = require('@frankjoke/myadapter').MyAdapter;

const scanList = {},
	tempName = '.Temperature',
	humName = '.Humidity',
	lightName = '.Light',
	airQualityName = '.AirQuality',
	noiseName = '.Noise',
	learnRf = 'RF',
	learnIr = '',
	learnName = '._Learn',
	sendName = '._SendCode',
	sceneName = '_SendScene',
	scenesName = '_Scenes',
	statesName = '_States',
	learnedName = '.L.',
	scanName = '_NewDeviceScan',
	reachName = '._notReachable',
	codeName = "CODE_",
	reCODE = /^CODE_|^/,
	reIsCODE = /^CODE_[a-f0-9]{16}/,
	defaultName = '_Rename_learned_';

let brlink, adapterObjects, firstCreate, states = {};

//A.I('Adapter starting...');
// eslint-disable-next-line
A.objChange = function (obj, val) { //	This is needed for name changes
	//	A.I(A.F(obj,' =O> ',val));
	val = val || A.D(' objChange val not defined');
	if (typeof obj === 'string' && obj.indexOf(learnedName) > 0)
		return A.getObject(obj)
			.then(oobj => {
				A.If('get object %O gets %O', obj, oobj);
				const nst = oobj.common,
					ncn = nst.name,
					// eslint-disable-next-line
					nid = ncn.replace(/[\ \.\,\;]/g, '_'),
					dev = obj.split('.'),
					fnn = dev.slice(2, -1).concat(nid).join('.');
				if (firstCreate || nid === dev[4] || nid.startsWith(defaultName)) // no need to rename!
					return null;
				if (!A.states[fnn] ? (!oobj.native.code ? A.W(`Cannot rename to ${oobj.common.name} because it does not have a learned code: ${obj}`, true) : false) :
					A.W(`Cannot rename to ${ncn} because the name is already used: ${obj}`, true)) {
					oobj.common.name = dev[4];
					return A.setObject(obj, oobj)
						.catch(e => A.W(`rename back err ${e} on ${A.O(oobj)}!`));
				}
				nst.id = (dev[2] + learnedName + nid);
				nst.native = oobj.native;
				//				nst.val = codeName + oobj.native.code;
				if (nid !== dev[4])
					return A.makeState(nst, false, true)
						.then(() => A.removeState(A.I(`rename ${obj} to ${fnn}!`, obj)).catch(() => true));
			}).then(() => A.wait(20))
			.then(() => A.getObjectList({
				startkey: A.ain,
				endkey: A.ain + '\u9999'
			}))
			.then(res => adapterObjects = (res.rows.length > 0 ? adapterObjects = res.rows.map(x => x.doc) : []))
			.catch(err => A.W(`objChange error: ${obj} ${err}`));
	return A.resolve();
};

function sendCode(device, value) {
	let buffer = new Buffer(value.replace(reCODE, ''), 'hex'); //var buffer = new Buffer(value.substr(5), 'hex'); // substr(5) removes CODE_ from string

	return device.setVal(buffer).then(x => device.name + ' sent ' + value + ', ' + x);
	//	return Promise.resolve(A.D('sendData to ' + device.name + ', Code: ' + value));
}

A.stateChange = function (id, state) {
	//	A.I(A.F(id,' =S> ',state));

	let thisDevice;

	function startLearning(name, type) {
		thisDevice = scanList[name];
		assert(!!thisDevice, `wrong name "${name}" in startLearning`);
		if (thisDevice.learning) return Promise.reject(A.W(`Device ${name} is still in learning mode and cannot start it again!`));
		A.I(`Start ${type}-learning for device: ${name}`);

		return A.makeState(name, thisDevice.learning = true, true)
			.then(() => thisDevice.learn(type === learnRf))
			.then(l => {
				if (l.data) {
					const hex = l.data;
					return A.getObjectList({
							startkey: A.ain + thisDevice.name + learnedName,
							endkey: A.ain + thisDevice.name + learnedName + '\u9999'
						})
						.catch(() => ({
							rows: []
						}))
						.then(res => {
							for (let i of res.rows)
								if (i.doc.native.code === hex) // ? i.doc.common.name
									return A.reject(i.doc.common.name + ':' + i.doc._id);
							return true;
						})
						.then(() => A.makeState({
								id: thisDevice.name + learnedName + codeName + hex,
								name: `${defaultName} ${type} ${A.dateTime()}`,
								write: true,
								role: 'button',
								type: typeof true,
								native: {
									code: hex
								}
							}, false, A.I(`Learned new ${type} Code ${thisDevice.name} (hex): ${hex}`, true)),
							nam => A.I(`Code alreadly learned from: ${thisDevice.name} with ${nam}`))
						.catch(err => A.W(`learning makeState error: ${thisDevice.name}} ${err}`))
						.then(() => A.wait(200))
						.then(() => firstCreate = false);
				}
				return Promise.resolve();
			})
			.then(() => A.I(`Stop learning ${type} for ${name}!`), () => A.I(`Stop learning ${type} for ${name}!`))
			.then(() => A.makeState(name, false, true))
			.then(A.nop, A.nop);
	}

	//	A.D(`stateChange of "${id}": ${A.O(state)}`); 
	if (!state.ack) {
		if (id.startsWith(A.ain))
			id = id.slice(A.ain.length);
		let idx = id.split('.'),
			id0 = idx[0];
		if (id0 === scanName && idx.slice(-1)[0] === scanName) return deviceScan();
		if (id0 === sceneName && idx.slice(-1)[0] === sceneName) {
			const scene = state.val;
			state.val = true;
			return sendScene(scene, state);
		}
		//		A.D(`Somebody (${state.from}) id0 ${id0} changed ${id} of "${id0}" to ${A.O(state)}`);
		if (id0 === scenesName)
			return A.getObject(id)
				.then((obj) =>
					obj && obj.native && obj.native.scene ?
					sendScene(obj.native.scene, state) :
					Promise.reject(A.D(`Invalid command "${id}" in scenes`)));
		if (id0 === statesName)
			return A.getObject(id)
				.then((obj) =>
					obj && obj.native && obj.native.state ?
					sendState(obj.native.state, state.val) :
					Promise.reject(A.D(`Invalid command "${id}" in states`)));
		let device = scanList[id0];
		if (!device) return Promise.reject(A.W(`stateChange error no device found: ${id} ${A.O(state)}`));
		switch (id0.split(':')[0]) {
			case 'SP':
				device.setVal(A.parseLogic(state.val));
				A.I(`Change ${id} to ${state.val}`);
				return Promise.resolve(device.oval = state.val);
			case 'RM':
				if (id.endsWith(sendName))
					return state.val.startsWith(codeName) ? sendCode(device, state.val) :
						Promise.reject(A.W(`Code to send to ${id0} needs to start with ${codeName}`));
				if (id.endsWith(learnName + learnIr))
					return startLearning(id0, learnIr);
				if (id.endsWith(learnName + learnRf))
					return startLearning(id0, learnRf);
				return reIsCODE.test(state.val) && sendCode(device, state.val) ||
					A.getObject(id)
					.then((obj) =>
						obj && obj.native && obj.native.code ?
						setState(obj.common.name).then(() => sendCode(device, obj.native.code)) :
						Promise.reject(A.W(`cannot get code to send for: ${id}=${id0} ${A.O(state)}`)));
			default:
				return Promise.reject(A.W(`stateChange error invalid id type: ${id}=${id0} ${A.O(state)}`));
		}
	} else return A.resolve();
};

function deviceScan() {
	if (!brlink) return Promise.reject(A.W(`No current driver to start discover!`));
	if (brlink.scanning) return Promise.reject(A.W(`Scan operation in progress, no new scan can be started until it finished!`));
	brlink.discover();
	return A.makeState({
			id: scanName,
			write: true,
			role: 'button',
			type: typeof true,
		}, brlink.scanning = true, true)
		.then(() => A.wait(5000)) // 6s for the scan of ip' should be OKs
		.then(() => A.makeState(scanName, brlink.scanning = false, true))
		.catch(err => A.W(`Error in deviceScan: ${brlink.scanning = false, A.O(err)}`));
}

function sendScene(scene, st) {
	const s = A.T(scene, []) ? A.trim(scene) : A.T(scene, '') ? A.trim(scene.split(',')) : `error in scene: neither a string nor an Array!: ${A.O(scene)}`;
	const sn = s.map(ss => A.trim(ss) === parseInt(ss).toString() ? parseInt(ss) : A.trim(ss));
	return A.seriesOf(sn, i => {
		if (typeof i === 'number')
			return A.wait(i);
		const mm = i.match(/^\s*(\d+)\s*\(\s*(\S+)\s*\)\s*(\d*)\s*$/);
		if (mm)
			return A.repeat(mm[1], () => sendScene([mm[2]], st).then(() => A.wait(mm[3] ? mm[3] : 300)));
		if (i.split('=').length === 2) {
			let s = A.trim(i.split('='));
			i = s[0];
			st.val = s[1];
		} else st.val = true;
		const f = adapterObjects.filter(x => x.common.name === i);
		if (f.length === 1)
			i = f[0]._id;
		else if (f.length > 1)
			A.W(`Multiple states with name '${i}: ${f.map(x => x._id)}`);
		if (i.startsWith(A.ain))
			i = i.slice(A.ain.length);

		const j = A.trim(i.split('.')),
			id = j[0],
			code = j[1];
		if (id.startsWith('RM:') && scanList[id] && code.startsWith(codeName))
			return sendCode(scanList[id], code);

		if (id.startsWith('RM:') || id.startsWith('SP:') || i.startsWith(scenesName + '.'))
			return A.stateChange(i, st);

		if (i.startsWith(statesName + '.'))
			return A.stateChange(i, {
				val: st.val
			});

		return A.getState(i).then(() =>
			A.setForeignState(i, st, false),
			(err) => A.W(`id ${i[0]} not found in scene ${scene} with err: ${A.O(err)}`));
	}, 100);
}

A.messages = (msg) => {
	if (A.T(msg.message) !== 'string')
		return A.W(`Wrong message received: ${A.O(msg)}`);
	const st = {
		val: true,
		ack: false,
		from: msg.from
	};
	let id = msg.message.startsWith(A.ain) ? msg.message.trim() : A.ain + (msg.message.trim());
	let ids, idx, code;

	switch (msg.command) {
		case 'switch_off':
			st.val = false;
			/* falls through */
		case 'switch_on':
		case 'send':
			return A.getObject(id)
				.then(obj => obj.common.role === 'button' || (obj.common.role === 'switch' && msg.command.startsWith('switch')) ?
					A.stateChange(id, st) :
					Promise.reject(A.W(`Wrong id or message ${A.O(msg)} id = ${A.O(obj)}`)),
					err => Promise.reject(err))
				.then(() => A.D(`got message sent: ${msg.message}`));
		case 'send_scene':
			return sendScene(msg.message, st);

		case 'send_code':

			if (msg.message.startsWith(A.ain))
				msg.message = msg.message.slice(A.ain.length);
			ids = msg.message.split('.');
			code = ids[1];
			id = ids[0];
			if (!id.startsWith('RM:') || !scanList[id] || !code.startsWith(codeName))
				return Promise.reject(A.D(`Invalid message "${msg.message}" for "send" to ${id}${sendName}`));
			return Promise.resolve(A.D(`Executed on ${id} the message "${msg.message}"`), sendCode(scanList[id], code));
		case 'get':
			return A.getState(id);
		case 'switch':
			idx = A.split(msg.message, '=');
			if (idx.length !== 2 && !idx.startsWith('SP:'))
				return Promise.reject(A.D(`Invalid message to "switch" ${msg.message}" to ${idx}`));
			st.val = A.parseLogic(idx[1]);
			return A.stateChange(idx[0], st);
		default:
			return Promise.reject(A.D(`Invalid command "${msg.command}" received with message ${A.O(msg)}`));
	}
};

let discoverAll = 0;

function doPoll() {
	let na = [];
	discoverAll = discoverAll >= 9 ? 0 : ++discoverAll;
	return A.seriesOf(A.obToArray(scanList), device => {
		if (!device.getAll || device.dummy) {
			if (!device.searchc) {
				device.searchm = 2;
				device.searchc = 1;
			}
			if (++device.searchc % device.searchm === 0) {
				na.push(device.host);
				if (device.searchm < 256) device.searchm *= 2;
			}
			return A.resolve();
		}
		return device.getAll().then(x => {
			A.Ir(x, 'Device %s returned %O', device.name, x);
			if (x && x.here && device.update) {
				return device.update(x);
			}
			if (x && x.here) {
				x.noUpdateFunction = 'do not know how to update';
			} else if (!x)
				x = {
					here: false
				};
			//				A.Ir(x, 'Device %s will reject %O', device.name, x);
			return A.reject(x);
		}).catch(e => {
			A.Df('device %s not reachable, waiting for it again %O', device.name, e);
			if (device.lastResponse && device.lastResponse < Date.now() - 1000 * 60 * 5) {
				if (device.close)
					device.close();
				A.W(`Device ${device.name} not reachable, switched it off and will search for it every while.`);
				return A.makeState(device.name + reachName, device.unreach = true, true);
			}
			return A.resolve();
		});
	}, 1).catch(err => A.W(`Error in polling: ${A.O(err)}`)).then(() => na.length ? brlink.discover(discoverAll ? na : undefined) : null);
}

function setState(name) {
	name = name.trim();
	let str = null;
	for (let k in states) {
		const st = states[k];
		let where = A.includes(st.on, name) ? st.on : A.includes(st.off, name) ? st.off : null;
		if (where) {
			str = {
				state: st,
				index: (where === st.off ? -1 : st.on.indexOf(name))
			};
			break;
		}
	}
	if (!str)
		return Promise.resolve();
	if (str.index < 0) // was found in off so switch state off!
		return A.changeState(str.state.id, false, true);
	return A.changeState(str.state.id, str.state ? true : str.index);
}

function sendState(state, val) {
	var send = A.T(val, 0) && state.on[val];
	if (A.T(val, true))
		send = val ? state.on[0] : state.off[0];
	if (state.mult && val > 9) {
		const vals = val.toString().split('').map(x => parseInt(x));
		return A.seriesOf(vals, num => sendState(state, num), 300);
	}
	const sobj = adapterObjects.filter(x => x.common.name === send);
	if (sobj.length > 1)
		A.W(`sendState error: multiple commands for name ${send}, ill use only first instance: ${sobj[0]._id}!`);
	return (sobj && sobj.length ? A.getObject(sobj[0]._id.slice(A.ain.length)) : Promise.resolve(null)).catch(() => null)
		.then(obj => {
			if (!obj)
				return A.W(`sendState could not find command or scene named '${send}'`);
			return A.stateChange(obj._id, {
				val: true,
				ack: false
			});
		})
		.then(() => A.makeState(state.id, val, true));
}

function genStates(array) {

	return A.seriesOf(array, state => {
			let name = state.name && state.name.trim(),
				on = state.on && state.on.trim(),
				off = state.off && state.off.trim();
			assert(name && on, `Invalid State without name or 'on' string: ${A.O(state)}`);
			if (!off || off === '')
				off = null;
			const mult = (off === '+');
			if (mult)
				off = null;
			on = A.trim(A.split(on, ','));
			const option = {
				id: statesName + '.' + name,
				name: name,
				type: off ? typeof true : typeof 0,
				role: off ? "switch" : "level",
				write: true,
			};
			if (!off) {
				option.min = 0;
				option.max = mult ? 9999 : on.length - 1;
				if (mult)
					option.states = null;
				else
					option.states = on.map((s, i) => `${i}:${s.trim()}`).join(';');
			}
			option.native = {
				state: {
					id: option.id,
					name: option.name,
					on: on,
					off: off ? A.trim(A.split(off, ',')) : null,
					mult: mult
				}
			};
			if (states[option.name])
				return Promise.resolve(A.W(`double state name will be ignored: ${option.name}`));
			states[option.name] = option.native.state;
			return A.makeState(option, undefined, true);
		}, 1)
		.catch(err => A.W(`genState generation error: ${err}`));
}

A.onStop = () => brlink.close(A.I('Close all connections...'));

// eslint-disable-next-line no-unused-vars
const AA = A.init(module, 'broadlink2', main); // associate adapter and main with MyAdapter

function updateValues(device, val, values) {
	return A.seriesOf(values, (item) => {
		let i = Object.assign({}, item);
		const name = i.name;
		delete i.name;
		i.id = device.host.name + i.id;
		if (val[name] !== undefined)
			return A.makeState(i, val[name], true);
	}).catch(e => e);
}

function main() {
	let didFind, notFound = [];

	if ((A.debug = A.C.ip.endsWith('!')))
		A.C.ip = A.C.ip.slice(A.D(`Debug mode on!`, 0), -1);

	let add = A.C.ip.split(',').map(x => x.split(':').map(s => s.trim()));

	brlink = new Broadlink(add);
//	brlink.on('15001', m => A.If('Got 15001 with m:%O ', m));


	brlink.on("deviceReady", function (device) {
		const typ = device.type.slice(0, 2);
		device.typ = typ;
		device.removeAllListeners('error');
		device.on('error', A.D);
		A.c2p(dns.reverse)(device.host.address)
			.then(x => A.T(x, []) ? x[0].toString().trim() : x.toString().trim(), () => device.host.mac)
			.then(x => {
				if (x.toLowerCase().endsWith(A.C.ip))
					x = x.slice(0, -A.C.ip.length);
				x = device.name = typ + ':' + x.split('.').join('-');
				if (scanList[x] && !scanList[x].dummy)
					return A.W(`Device found already: ${x} with ${A.O(device.host)}`);
				device.host.name = x;
				A.If('Device %s dedected: address=%s, mac=%s, typ=%s, id=%s devtype=%s', x, device.host.address, device.host.mac, device.host.type, device.host.devhex, device.host.devname);
				scanList[x] = device;
				switch (device.typ) {
					case 'SP':
						device.oval = undefined;
						device.update = (val) => {
							//							A.If('Should update %s with %O', device.host.name, val);
							return Promise.resolve().then(() => {
									if (val.state !== undefined && device.oval !== val.state) {
										if (device.oval !== undefined)
											A.I(`Switch ${device.name} changed to ${val.state} most probably manually!`);
										device.oval = val.state;
										return A.makeState({
											id: device.host.name,
											write: true,
											role: 'switch',
											type: typeof true,
											native: {
												host: device.host
											}
										}, val.state, true);
									}
									return Promise.resolve();
								})
								.then(() => updateValues(device, val, [{
									name: 'energy',
									id: '.CurrentPower',
									role: "level",
									write: false,
									unit: "W",
									type: typeof 1.1
								}, {
									name: 'nightlight',
									id: '.NightLight',
									role: "switch",
									write: true,
									type: typeof true
								}]))
								.catch(e => A.Wf('Update device %s Error: %O', device.host.name, e));
						};
						break;
					case 'S1':
						device.update = (val) => {
							return A.seriesOf(A.ownKeysSorted(val), (i) => i.length > 10 ? A.makeState({
									id: device.host.name + '.' + i,
									write: false,
									role: 'value',
									type: typeof 1,
									native: {
										host: device.host
									}
								}, val.state, true) : A.resolve(), 1)
								.catch(e => A.Wf('Update device %s Error: %O', device.host.name, e));
						};
						break;
					case 'RM':
						device.ltemp = undefined;
						device.update = (val) => {
							//							A.If('Should update %s with %O', device.host.name, val);
							return Promise.resolve()
								.then(() => updateValues(device, val, [{
									id: tempName,
									role: "temperature",
									write: false,
									unit: "°C",
									type: typeof 1.1
								}]));
						};
						A.makeState({
								id: x,
								role: "value",
								write: true,
								type: typeof true,
								native: {
									host: device.host
								}
							}, false, true)
							.then(() => A.makeState({
								id: x + learnName + learnIr,
								write: true,
								role: 'button',
								type: typeof true,
							}, false, true))
							.then(() => A.makeState({
								id: x + sendName,
								role: "text",
								write: true,
								type: typeof ''
							}, ' ', true))
							.then(() => device.type === 'RMP' ? A.makeState({
								id: x + learnName + learnRf,
								write: true,
								role: 'button',
								type: typeof true,
							}, false, true) : null);
						break;
					case 'A1':
						device.update = (val) => {
							//							A.If('Should update %s with %O', device.host.name, val);
							return Promise.resolve()
								.then(() => updateValues(device, val, [{
									id: '',
									name: 'temperature',
									type: typeof 1.1,
									role: "value.temperature",
									write: false,
									unit: "°C",
									native: {
										host: device.host
									}
								}, {
									id: humName,
									name: 'humidity',
									type: typeof 1.1,
									role: "value.humidity",
									write: false,
									min: 0,
									max: 100,
									unit: "%"
								}, {
									id: lightName,
									name: 'light',
									type: typeof 0,
									role: "value",
									min: 0,
									max: 3,
									states: "0:finster;1:dunkel;2:normal;3:hell"
								}, {
									id: airQualityName,
									name: 'air_quality',
									type: typeof 0,
									role: "value",
									min: 0,
									max: 3,
									states: "0:sehr gut;1:gut;2:normal;3:schlecht"
								}, {
									id: noiseName,
									name: 'noise',
									type: typeof 0,
									role: "value",
									min: 0,
									max: 3,
									states: "0:ruhig;1:normal;2:laut;3:sehr laut"
								}]))
								.catch(e => A.Wf('Update device %s Error: %O', device.host.name, e));
						};
						break;
					case 'T1':
						device.update = (val) => A.Df('Update T1 %s with %O',device.name, val);
						break;
					default:
						A.D(`Unknown ${device.typ} with ${A.O(device)}`);
				}
				return A.makeState({
					id: device.name + reachName,
					write: false,
					role: 'indicator.unreach',
					type: typeof true,
				}, device.unreach = false, true);
			}).catch(e => A.W(`Error in device dedect: "${e}"`));
		return false;
	});

	A.D('Config IP-Address end to remove: ' + A.C.ip);
	A.seriesOf(A.C.scenes, scene =>
			A.makeState({
				id: scenesName + '.' + scene.name.trim(),
				write: true,
				role: 'button',
				type: typeof true,
				native: {
					scene: scene.scene
				}
			}), 100)
		.then(() => brlink.start15001())
		.then(() => deviceScan(A.I('Discover Broadlink devices for 10sec on ' + A.ains)))
		.then(() => genStates(A.C.switches))
		.then(() => A.getObjectList({
			startkey: A.ain,
			endkey: A.ain + '\u9999'
		}))
		.then(res => adapterObjects = res.rows.length > 0 ? A.D(A.name + ` has  ${res.rows.length} old states!`, adapterObjects = res.rows.map(x => x.doc)) : [])
		.then(() => didFind = Object.keys(scanList))
		.then(() => A.seriesOf(adapterObjects.filter(x => x.native && x.native.host), dev => {
			let id = dev.native.host.name; // dev._id.slice(A.ain.length);
			if (!scanList[id] && !id.endsWith(learnName + learnRf) && !id.endsWith(learnName + learnIr)) {
				let device = {
					name: id,
					fun: Promise.reject,
					host: dev.native.host,
					dummy: true
				};
				A.W(`device ${id} not found, please rescan later again or delete it! It was: ${A.obToArray(device.host)}`);
				scanList[id] = device;
				notFound.push(id);
			}
			return Promise.resolve(true);
		}, 1))
		.then(() => doPoll())
		.then(() => A.makeState({
			id: sceneName,
			write: true,
			role: 'text',
			type: typeof '',
		}, ' ', true))
		.then(() => {
			const p = parseInt(A.C.poll);
			if (p) {
				setInterval(doPoll, p * 1000);
				A.D(`Poll every ${p} secods.`);
			}
		})
		.then(() => (A.I(`${A.ains} started and found ${didFind.length} devices named '${didFind.join("', '")}'.`),
			notFound.length > 0 ? A.I(`${notFound.length} were not found: ${notFound}`) : null), e => A.W(`Error in main: ${e}`))
		.catch(e => A.W(`Unhandled error in main: ${e}`));
}