const _ = require('lodash');
const { checkFieldPropertiesChanged } = require('../common');
const { AlterScriptDto } = require('../types/AlterScriptDto');

const renameColumnHelpers = ddlProvider => {
	const getRenameColumnScriptsDto = (collectionProperties, fullName) => {
		return _.values(collectionProperties)
			.filter(jsonSchema => checkFieldPropertiesChanged(jsonSchema.compMod, ['name']))
			.map(jsonSchema => {
				const script = ddlProvider.renameColumn(
					fullName,
					jsonSchema.compMod.oldField.name,
					jsonSchema.compMod.newField.name,
				);

				return AlterScriptDto.getInstance([script], true, false);
			});
	};

	return {
		getRenameColumnScriptsDto,
	};
};

module.exports = renameColumnHelpers;
