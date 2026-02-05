const _ = require('lodash');
const { AlterScriptDto } = require('../types/AlterScriptDto');
const { checkFieldPropertiesChanged } = require('../common');
const { createColumnDefinitionBySchema } = require('./createColumnDefinition');

const alterTypeHelper = ddlProvider => {
	const getChangeTypeScriptsDto = (collectionProperties, fullName, collectionSchema, schemaName) => {
		const schemaData = { schemaName };

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

				return AlterScriptDto.getInstance([ddlProvider.alterColumn(fullName, columnDefinition)], true, false);
			});
	};

	return {
		getChangeTypeScriptsDto,
	};
};

module.exports = alterTypeHelper;
