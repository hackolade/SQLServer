const _ = require('lodash');
const { checkFieldPropertiesChanged } = require('../common');
const { AlterScriptDto } = require('../types/AlterScriptDto');
const { isCollectionInDeltaModelActivated } = require('../../../utils/general');

const renameColumnHelpers = ddlProvider => {
	const getRenameColumnScriptsDto = (collection, fullName) => {
		const isCollectionActivated = isCollectionInDeltaModelActivated(collection);

		return _.values(collection.properties)
			.filter(jsonSchema => checkFieldPropertiesChanged(jsonSchema.compMod, ['name']))
			.map(jsonSchema => {
				const script = ddlProvider.renameColumn(
					fullName,
					jsonSchema.compMod.oldField.name,
					jsonSchema.compMod.newField.name,
				);

				const isActivated = isCollectionActivated && jsonSchema.isActivated !== false;

				return AlterScriptDto.getInstance([script], isActivated, false);
			});
	};

	return {
		getRenameColumnScriptsDto,
	};
};

module.exports = renameColumnHelpers;
