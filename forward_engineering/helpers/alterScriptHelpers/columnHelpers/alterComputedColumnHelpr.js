'use strict';

const _ = require('lodash');

module.exports = (app, ddlProvider) => {
	const { createColumnDefinitionBySchema } = require('./createColumnDefinition')(_);
	const { AlterScriptDto } = require('../types/AlterScriptDto');
	const { compareObjectsByProperties } = require('../../../utils/general')(_);

	const changeToComputed = (fullName, columnName, columnDefinition) => {
		return [
			AlterScriptDto.getInstance([ddlProvider.dropColumn(fullName, columnName)], true, true),
			AlterScriptDto.getInstance(
				[ddlProvider.alterComputedColumn(fullName, columnName, columnDefinition)],
				true,
				false,
			),
		];
	};

	const changeToNonComputed = (fullName, columnName, columnDefinition) => {
		return [
			AlterScriptDto.getInstance([ddlProvider.dropColumn(fullName, columnName)], true, true),
			AlterScriptDto.getInstance([ddlProvider.alterColumn(fullName, columnDefinition)], true, false),
		];
	};

	const propsToDetectChange = ['computed', 'computedExpression', 'persisted', 'unique', 'primaryKey'];

	const generateSqlAlterScript = ({
		collectionSchema,
		prevJsonSchema,
		jsonSchema,
		fullName,
		columnName,
		schemaName,
		toAddNotNull,
		toRemoveNotNull,
	}) => {
		const schemaData = { schemaName };
		const columnDefinition = createColumnDefinitionBySchema({
			name: columnName,
			jsonSchema,
			parentJsonSchema: collectionSchema,
			ddlProvider,
			schemaData,
		});
		columnDefinition.nullable = toRemoveNotNull;
		let sqlScripts = [];

		const isComputedRemoved = prevJsonSchema.computed && !jsonSchema.computed;
		const isComputedEnabled = !prevJsonSchema.computed && jsonSchema.computed;
		const isComputedModified =
			prevJsonSchema.computed &&
			jsonSchema.computed &&
			(compareObjectsByProperties(prevJsonSchema, jsonSchema, propsToDetectChange) ||
				toAddNotNull ||
				toRemoveNotNull);

		if ((isComputedRemoved || isComputedModified) && !jsonSchema.computedExpression) {
			sqlScripts = changeToNonComputed(fullName, columnName, columnDefinition);
		}

		if ((isComputedEnabled || isComputedModified) && jsonSchema.computedExpression) {
			sqlScripts = changeToComputed(fullName, columnName, columnDefinition);
		}

		return sqlScripts;
	};

	const getChangedComputedColumnsScriptsDto = ({ collection, fullName, collectionSchema, schemaName }) => {
		return _.flatten(
			_.toPairs(collection.properties).reduce((result, [columnName, jsonSchema]) => {
				const oldJsonSchema = _.omit(collection.role?.properties?.[columnName], ['compMod']);

				const currentRequiredColumnNames = collection.required || [];
				const previousRequiredColumnNames = collection.role.required || [];

				const toAddNotNull =
					_.difference(currentRequiredColumnNames, previousRequiredColumnNames).indexOf(columnName) !== -1;
				const toRemoveNotNull =
					_.difference(previousRequiredColumnNames, currentRequiredColumnNames).indexOf(columnName) !== -1;

				result.push(
					generateSqlAlterScript({
						collectionSchema,
						prevJsonSchema: oldJsonSchema,
						jsonSchema,
						fullName,
						columnName,
						schemaName,
						toAddNotNull,
						toRemoveNotNull,
					}),
				);

				return result;
			}, []),
		);
	};

	return {
		getChangedComputedColumnsScriptsDto,
	};
};
