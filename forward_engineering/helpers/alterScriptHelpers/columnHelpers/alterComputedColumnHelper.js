const _ = require('lodash');
const { createColumnDefinitionBySchema } = require('./createColumnDefinition');
const { AlterScriptDto } = require('../types/AlterScriptDto');
const { compareObjectsByProperties, isCollectionInDeltaModelActivated } = require('../../../utils/general');

const alterComputedColumnHelper = ddlProvider => {
	const changeToComputed = (fullName, columnName, columnDefinition, isActivated) => {
		return [
			AlterScriptDto.getInstance([ddlProvider.dropColumn(fullName, columnName)], isActivated, true),
			AlterScriptDto.getInstance(
				[ddlProvider.alterComputedColumn(fullName, columnName, { ...columnDefinition, isActivated: true })],
				isActivated,
				false,
			),
		];
	};

	const changeToNonComputed = (fullName, columnName, columnDefinition, isActivated) => {
		return [
			AlterScriptDto.getInstance([ddlProvider.dropColumn(fullName, columnName)], isActivated, true),
			AlterScriptDto.getInstance([ddlProvider.alterColumn(fullName, columnDefinition)], isActivated, false),
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
		dbVersion,
		isCollectionActivated,
	}) => {
		const schemaData = { schemaName, dbVersion };
		const columnDefinition = createColumnDefinitionBySchema({
			name: columnName,
			jsonSchema,
			parentJsonSchema: collectionSchema,
			ddlProvider,
			schemaData,
		});
		columnDefinition.nullable = toRemoveNotNull;
		const isActivated = isCollectionActivated && jsonSchema.isActivated !== false;
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
			sqlScripts = changeToNonComputed(fullName, columnName, columnDefinition, isActivated);
		}

		if ((isComputedEnabled || isComputedModified) && jsonSchema.computedExpression) {
			sqlScripts = changeToComputed(fullName, columnName, columnDefinition, isActivated);
		}

		return sqlScripts;
	};

	const getChangedComputedColumnsScriptsDto = ({ collection, fullName, collectionSchema, schemaName, dbVersion }) => {
		const isCollectionActivated = isCollectionInDeltaModelActivated(collection);

		return _.toPairs(collection.properties)
			.reduce((result, [columnName, jsonSchema]) => {
				const oldJsonSchema = _.omit(collection.role?.properties?.[columnName], ['compMod']);

				const currentRequiredColumnNames = collection.required || [];
				const previousRequiredColumnNames = collection.role.required || [];

				const toAddNotNull = _.difference(currentRequiredColumnNames, previousRequiredColumnNames).includes(
					columnName,
				);
				const toRemoveNotNull = _.difference(previousRequiredColumnNames, currentRequiredColumnNames).includes(
					columnName,
				);

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
						dbVersion,
						isCollectionActivated,
					}),
				);

				return result;
			}, [])
			.flat();
	};

	return {
		getChangedComputedColumnsScriptsDto,
	};
};

module.exports = alterComputedColumnHelper;
