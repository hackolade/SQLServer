const {
	parseDataForEntityLevelScript,
	buildEntityLevelAlterScript,
} = require('../helpers/alterScriptHelpers/alterScriptBuilder');

/**
 * @typedef {import('../types/coreApplicationTypes').App} App
 * @typedef {import('../types/coreApplicationTypes').Logger} Logger
 * @typedef {import('../types/coreApplicationTypes').CoreData} CoreData
 * @typedef {import('../types/coreApplicationTypes').PluginError} PluginError
 **/

/**
 * @param data {CoreData}
 * @param logger {Logger}
 * @param callback {PluginCallback}
 * @param app {App}
 * */
function generateScript(data, logger, callback, app) {
	try {
		const parsedData = parseDataForEntityLevelScript(data, app);
		const scripts = buildEntityLevelAlterScript(data, app)(parsedData);

		callback(null, scripts);
	} catch (error) {
		logger.log('error', { message: error.message, stack: error.stack }, 'MS SQL Server Forward-Engineering Error');

		callback({ message: error.message, stack: error.stack });
	}
}

module.exports = {
	generateScript,
};
