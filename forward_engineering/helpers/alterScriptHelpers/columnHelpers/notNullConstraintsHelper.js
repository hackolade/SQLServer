const _ = require('lodash');
const { AlterScriptDto } = require('../types/AlterScriptDto');
const { getFullTableName, wrapInBrackets } = require('../../../utils/general');
const { createColumnDefinitionBySchema } = require('./createColumnDefinition');

/**
 * @return {(collection: Collection) => AlterScriptDto[]}
 * */
const getModifyNonNullColumnsScriptDtos = ddlProvider => (collection, collectionSchema, schemaName, dbVersion) => {
	const fullTableName = getFullTableName(collection);
	const schemaData = { schemaName, dbVersion };

	const currentRequiredColumnNames = collection.required || [];
	const previousRequiredColumnNames = collection.role.required || [];

	const columnNamesToAddNotNullConstraint = _.difference(currentRequiredColumnNames, previousRequiredColumnNames);
	const columnNamesToRemoveNotNullConstraint = _.difference(previousRequiredColumnNames, currentRequiredColumnNames);

	const addNotNullConstraintsScript = _.toPairs(collection.properties)
		.filter(([name, jsonSchema]) => {
			const oldName = jsonSchema.compMod.oldField.name;
			const shouldRemoveForOldName = columnNamesToRemoveNotNullConstraint.includes(oldName);
			const shouldAddForNewName = columnNamesToAddNotNullConstraint.includes(name);
			return shouldAddForNewName && !shouldRemoveForOldName && !jsonSchema.computed;
		})
		.map(([columnName, jsonSchema]) => {
			const columnDefinition = createColumnDefinitionBySchema({
				name: columnName,
				jsonSchema,
				parentJsonSchema: collectionSchema,
				ddlProvider,
				schemaData,
			});

			return ddlProvider.setNotNullConstraint(fullTableName, wrapInBrackets(columnName), columnDefinition);
		})
		.map(script => AlterScriptDto.getInstance([script], true, false));

	const removeNotNullConstraint = _.toPairs(collection.properties)
		.filter(([name, jsonSchema]) => {
			const oldName = jsonSchema.compMod.oldField.name;
			const shouldRemoveForOldName = columnNamesToRemoveNotNullConstraint.includes(oldName);
			const shouldAddForNewName = columnNamesToAddNotNullConstraint.includes(name);

			return shouldRemoveForOldName && !shouldAddForNewName && !jsonSchema.computed;
		})
		.map(([name, jsonSchema]) => {
			const columnDefinition = createColumnDefinitionBySchema({
				name,
				jsonSchema,
				parentJsonSchema: collectionSchema,
				ddlProvider,
				schemaData,
			});

			return ddlProvider.dropNotNullConstraint(fullTableName, wrapInBrackets(name), columnDefinition);
		})
		.map(script => AlterScriptDto.getInstance([script], true, true));

	return [...addNotNullConstraintsScript, ...removeNotNullConstraint];
};

module.exports = {
	getModifyNonNullColumnsScriptDtos,
};
