/**
 * @typedef {import('./helpers/alterScriptHelpers/types/AlterScriptDto').AlterScriptDto} AlterScriptDto
 * @typedef {import('./types/coreApplicationTypes').App} App
 * @typedef {import('./types/coreApplicationTypes').CoreData} CoreData
 * */

/**
 * @typedef {{
 *     externalDefinitions: unknown,
 *     modelDefinitions: unknown,
 *     jsonSchema: unknown,
 *     internalDefinitions: unknown
 * }} EntityLevelAlterScriptData
 * */

/**
 * @typedef {{
 *     externalDefinitions: unknown,
 *     modelDefinitions: unknown,
 *     entitiesJsonSchema: unknown,
 *     internalDefinitions: unknown
 * }} ContainerLevelAlterScriptData
 * */

const _ = require('lodash');
const { getAlterScriptDtos } = require('../alterScriptFromDeltaHelper');
const { joinAlterScriptDtosIntoAlterScript } = require('../alterScriptFromDeltaHelper');

const parseEntities = (entities, serializedItems) => {
	return entities.reduce((result, entityId) => {
		try {
			return { ...result, [entityId]: JSON.parse(serializedItems[entityId]) };
		} catch {
			return result;
		}
	}, {});
};

/**
 * @param data {CoreData}
 * @return {{
 *      jsonSchema: unknown,
 *      modelDefinitions: ModelDefinitions | unknown,
 *      internalDefinitions: InternalDefinitions | unknown,
 *      externalDefinitions: ExternalDefinitions | unknown,
 *      containerData: ContainerData | unknown,
 *      entityData: unknown,
 * }}
 * */
const parseDataForEntityLevelScript = data => {
	const jsonSchema = JSON.parse(data.jsonSchema);
	const modelDefinitions = JSON.parse(data.modelDefinitions);
	const internalDefinitions = _.isObject(data.internalDefinitions)
		? parseEntities(data.entities, data.internalDefinitions)
		: JSON.parse(data.internalDefinitions);
	const externalDefinitions = JSON.parse(data.externalDefinitions);
	const containerData = data.containerData;
	const entityData = data.entityData;

	return {
		jsonSchema,
		modelDefinitions,
		internalDefinitions,
		externalDefinitions,
		containerData,
		entityData,
	};
};

/**
 * @param data {CoreData}
 * @param app {App}
 * @return {(dto: EntityLevelAlterScriptData) => Array<AlterScriptDto>}
 * */
const getEntityLevelAlterScriptDtos =
	(data, app) =>
	({ jsonSchema }) => {
		return getAlterScriptDtos(jsonSchema, app, data.options);
	};

/**
 * @param data {CoreData}
 * @param app {App}
 * @return {(dto: EntityLevelAlterScriptData) => string}
 * */
const buildEntityLevelAlterScript = (data, app) => entityLevelAlterScriptDto => {
	const alterScriptDtos = getEntityLevelAlterScriptDtos(data, app)(entityLevelAlterScriptDto);

	return joinAlterScriptDtosIntoAlterScript(alterScriptDtos, data);
};

module.exports = {
	buildEntityLevelAlterScript,
	parseDataForEntityLevelScript,
};
