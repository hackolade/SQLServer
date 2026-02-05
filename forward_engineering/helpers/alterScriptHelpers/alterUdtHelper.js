const _ = require('lodash');
const { AlterScriptDto } = require('./types/AlterScriptDto');
const { createColumnDefinitionBySchema } = require('./columnHelpers/createColumnDefinition');

const alterUdtHelper = (app, options) => {
	const ddlProvider = require('../../ddlProvider')(null, options, app);

	const DEFAULT_KEY_SPACE = { 'Default_Keyspace': [] };

	const getSchemaNames = udt => {
		const schemaNames = udt.compMod?.bucketsWithCurrentDefinition;
		return _.isEmpty(schemaNames) ? DEFAULT_KEY_SPACE : schemaNames;
	};

	const getCreateUdtScriptDto = jsonSchema => {
		const schemaNames = getSchemaNames(jsonSchema);

		return Object.keys(schemaNames).map(schemaName => {
			const schemaData = { schemaName };

			const udt = createColumnDefinitionBySchema({
				name: jsonSchema.code || jsonSchema.name,
				jsonSchema: jsonSchema,
				parentJsonSchema: { required: [] },
				ddlProvider,
				schemaData,
			});

			return AlterScriptDto.getInstance([ddlProvider.createUdt({ ...udt, schemaName })], true, false);
		});
	};

	const getDeleteUdtScriptDto = udt => {
		const schemaNames = getSchemaNames(udt);
		return Object.keys(schemaNames).map(schemaName => {
			const name = udt.code || udt.name || '';

			return AlterScriptDto.getInstance([ddlProvider.dropUdt({ name, schemaName })], true, true);
		});
	};

	return {
		getCreateUdtScriptDto,
		getDeleteUdtScriptDto,
	};
};

module.exports = alterUdtHelper;
