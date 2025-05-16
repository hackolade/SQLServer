const os = require('os');
const packageFile = require('../../package.json');

const prefixZero = number => (number < 10 ? '0' + number : number);

const maxClock = cpus => {
	return cpus.reduce((highestClock, cpu) => Math.max(highestClock, cpu.speed), 0);
};

const toTime = number => {
	return Math.floor(number / 3600) + ':' + prefixZero(parseInt((number / 3600 - Math.floor(number / 3600)) * 60));
};

const getPluginVersion = () => packageFile.version;

const getSystemInfo = appVersion => {
	return (
		'' +
		`Date: ${new Date()}` +
		'\n' +
		`Application version: ${appVersion}` +
		'\n' +
		`Plugin version: ${getPluginVersion()}` +
		'\n\n' +
		`System information:` +
		'\n' +
		` Hostname:  ${os.hostname()}` +
		'\n' +
		` Platform:  ${os.platform()} ${os.arch()}` +
		'\n' +
		` Release:   ${os.release()}` +
		'\n' +
		` Uptime:    ${toTime(os.uptime())}` +
		'\n' +
		` Total RAM: ${(os.totalmem() / 1073741824).toFixed(2)} GB` +
		'\n' +
		` CPU Model: ${os.cpus()[0].model}` +
		'\n' +
		` CPU Clock: ${maxClock(os.cpus())} MHZ` +
		'\n' +
		` CPU Cores: ${os.cpus().length} cores` +
		'\n\n'
	);
};

const logInfo = (step, connectionInfo, logger) => {
	logger.clear();
	logger.log('info', getSystemInfo(connectionInfo.appVersion), step);
	logger.log('info', connectionInfo, 'connectionInfo', connectionInfo.hiddenKeys);
};

module.exports = logInfo;
