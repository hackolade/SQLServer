const _ = require('lodash');
const { AlterScriptDto } = require('../types/AlterScriptDto');
const { checkFieldPropertiesChanged } = require('../common');
const { createColumnDefinitionBySchema } = require('./createColumnDefinition');
const { isCollectionInDeltaModelActivated } = require('../../../utils/general');

const alterTypeHelper = (ddlProvider, options) => {
	const getChangeTypeScriptsDto = (collectionProperties, fullName, collectionSchema, schemaName) => {
		const schemaData = { schemaName, dbVersion: options.dbVersion };
		const isCollectionActivated = isCollectionInDeltaModelActivated(collectionSchema);

		return _.toPairs(collectionProperties)
			.filter(([name, jsonSchema]) => checkFieldPropertiesChanged(jsonSchema.compMod, ['type', 'mode']))
			.map(([name, jsonSchema]) => {
				const columnDefinition = createColumnDefinitionBySchema({
					name,
					jsonSchema,
					parentJsonSchema: collectionSchema,
					ddlProvider,
					schemaData,
				});

				const isActivated = isCollectionActivated && jsonSchema.isActivated !== false;

				return AlterScriptDto.getInstance(
					[ddlProvider.alterColumn(fullName, columnDefinition)],
					isActivated,
					false,
				);
			});
	};

	return {
		getChangeTypeScriptsDto,
	};
};

module.exports = alterTypeHelper;
