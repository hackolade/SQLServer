const { generateScript } = require('./api/generateScript');
const { generateContainerScript } = require('./api/generateContainerScript');
const { isDropInStatements } = require('./api/isDropInStatements');
const { testConnection, getExternalBrowserUrl } = require('./api/testConnection');
const { applyToInstance } = require('./api/applyToInstance');

/**
 * @typedef {import('./helpers/alterScriptHelpers/types/AlterScriptDto').AlterScriptDto} AlterScriptDto
 * @typedef {import('./types/coreApplicationDataTypes').ContainerJsonSchema} ContainerJsonSchema
 * @typedef {import('./types/coreApplicationDataTypes').ContainerStyles} ContainerStyles
 * @typedef {import('./types/coreApplicationDataTypes').EntityData} EntityData
 * @typedef {import('./types/coreApplicationDataTypes').EntityJsonSchema} EntityJsonSchema
 * @typedef {import('./types/coreApplicationDataTypes').ExternalDefinitions} ExternalDefinitions
 * @typedef {import('./types/coreApplicationDataTypes').InternalDefinitions} InternalDefinitions
 * @typedef {import('./types/coreApplicationDataTypes').ModelDefinitions} ModelDefinitions

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
	generateScript,
	generateViewScript(data, logger, callback, app) {
		callback(new Error('Forward-Engineering of delta model on view level is not supported'));
	},
	generateContainerScript,
	isDropInStatements,
	testConnection,
	applyToInstance,
	getExternalBrowserUrl,
};
