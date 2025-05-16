const { DROP_STATEMENTS } = require('./helpers/constants');
const logInfo = require('../reverse_engineering/helpers/logInfo');
const { connect, getExternalBrowserUrl } = require('../reverse_engineering/api');
const { logDatabaseVersion } = require('../reverse_engineering/reverseEngineeringService/reverseEngineeringService');
const applyToInstanceHelper = require('./helpers/applyToInstanceHelper');
const {
	buildEntityLevelAlterScript,
	parseDataForEntityLevelScript,
} = require('./helpers/alterScriptHelpers/alterScriptBuilder');

/**
 * @typedef {import('./helpers/alterScriptHelpers/types/AlterScriptDto').AlterScriptDto} AlterScriptDto
 * @typedef {import('./types/coreApplicationDataTypes').ContainerJsonSchema} ContainerJsonSchema
 * @typedef {import('./types/coreApplicationDataTypes').ContainerStyles} ContainerStyles
 * @typedef {import('./types/coreApplicationDataTypes').EntityData} EntityData
 * @typedef {import('./types/coreApplicationDataTypes').EntityJsonSchema} EntityJsonSchema
 * @typedef {import('./types/coreApplicationDataTypes').ExternalDefinitions} ExternalDefinitions
 * @typedef {import('./types/coreApplicationDataTypes').InternalDefinitions} InternalDefinitions
 * @typedef {import('./types/coreApplicationDataTypes').ModelDefinitions} ModelDefinitions
 * @typedef {import('./types/coreApplicationTypes').App} App
 * @typedef {import('./types/coreApplicationTypes').Logger} Logger
 * @typedef {import('./types/coreApplicationTypes').CoreData} CoreData
 * @typedef {import('./types/coreApplicationTypes').PluginError} PluginError
 *
 * @typedef {(error?: PluginError | null, result?: any | null) => void} PluginCallback
 * */

/**
 * @typedef {[ContainerJsonSchema, ContainerStyles]} ContainerData
 * */
/**
 * @typedef {{
 *     [id: string]: EntityJsonSchema
 * }} EntitiesJsonSchema
 */

/**
 * @typedef {[ContainerJsonSchema, ContainerStyles]} ContainerData
 * */
/**
 * @typedef {{
 *     [id: string]: EntityJsonSchema
 * }} EntitiesJsonSchema
 */

module.exports = {
	/**
	 * @param data {CoreData}
	 * @param logger {Logger}
	 * @param callback {PluginCallback}
	 * @param app {App}
	 * */
	generateScript(data, logger, callback, app) {
		try {
			const parsedData = parseDataForEntityLevelScript(data, app);
			const scripts = buildEntityLevelAlterScript(data, app)(parsedData);

			callback(null, scripts);
		} catch (error) {
			logger.log(
				'error',
				{ message: error.message, stack: error.stack },
				'MS SQL Server Forward-Engineering Error',
			);

			callback({ message: error.message, stack: error.stack });
		}
	},
	generateViewScript(data, logger, callback, app) {
		callback(new Error('Forward-Engineering of delta model on view level is not supported'));
	},
	generateContainerScript(data, logger, callback, app) {
		try {
			data.jsonSchema = data.collections[0];
			this.generateScript(data, logger, callback, app);
		} catch (error) {
			logger.log(
				'error',
				{ message: error.message, stack: error.stack },
				'MS SQL Server Forward-Engineering Error',
			);

			callback({ message: error.message, stack: error.stack });
		}
	},
	isDropInStatements(data, logger, callback, app) {
		try {
			const cb = (error, script = '') =>
				callback(
					error,
					DROP_STATEMENTS.some(statement => script.includes(statement)),
				);

			if (data.level === 'container') {
				this.generateContainerScript(data, logger, cb, app);
			} else {
				this.generateScript(data, logger, cb, app);
			}
		} catch (e) {
			callback({ message: e.message, stack: e.stack });
		}
	},
	async testConnection(connectionInfo, logger, callback, app) {
		try {
			logInfo('Test connection', connectionInfo, logger);
			if (connectionInfo.authMethod === 'Azure Active Directory (MFA)') {
				await getExternalBrowserUrl(connectionInfo, logger, callback, app);
			} else {
				const client = await connect(connectionInfo, logger, () => {}, app);
				await logDatabaseVersion({ client, logger });
			}
			callback(null);
		} catch (error) {
			logger.log('error', { message: error.message, stack: error.stack, error }, 'Test connection');
			callback({ message: error.message, stack: error.stack });
		}
	},
	async applyToInstance(connectionInfo, logger, callback, app) {
		logger.clear();
		logInfo('Apply To Instance', connectionInfo, logger);

		try {
			await applyToInstanceHelper.applyToInstance(connectionInfo, logger, app);
			callback(null);
		} catch (error) {
			callback(error);
		}
	},

	async getExternalBrowserUrl(connectionInfo, logger, cb, app) {
		return getExternalBrowserUrl(connectionInfo, logger, cb, app);
	},
};
