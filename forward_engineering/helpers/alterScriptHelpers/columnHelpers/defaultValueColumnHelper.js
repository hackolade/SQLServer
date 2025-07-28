module.exports = (app, ddlProvider) => {
	const { AlterScriptDto } = require('../types/AlterScriptDto');
	const { sanitizeConstraintName } = require('../../../helpers/general')(app);

	const getDefaultValueChangeDto = (collection, fullName) => {
		const scripts = [];

		const getDefaultConstraintName = columnName => sanitizeConstraintName(`DF_${fullName}_${columnName}`);

		Object.entries(collection?.properties ?? []).forEach(([columnName, collectionSchema]) => {
			const newDefaultValue = collectionSchema.default;
			const newConstraintName = collectionSchema.defaultConstraintName;
			const oldDefaultValue = collection.role.properties[columnName]?.default;
			const oldConstraintName = collection.role.properties[columnName]?.defaultConstraintName;

			const defaultValueWasRemoved = !!oldDefaultValue && !newDefaultValue;
			const defaultValueWasAdded = !oldDefaultValue && !!newDefaultValue;
			const defaultValueWasChanged =
				!!oldDefaultValue && !!newDefaultValue && oldDefaultValue !== newDefaultValue;
			const constraintNameChanged =
				!!oldDefaultValue &&
				!!newDefaultValue &&
				oldDefaultValue === newDefaultValue &&
				!!oldConstraintName &&
				!!newConstraintName &&
				oldConstraintName !== newConstraintName;

			switch (true) {
				case defaultValueWasRemoved: {
					if (oldConstraintName) {
						const dropScript = ddlProvider.dropConstraint(fullName, oldConstraintName);
						scripts.push(AlterScriptDto.getInstance([dropScript], true, true));
					}
					break;
				}
				case defaultValueWasAdded: {
					const constraintName = newConstraintName || getDefaultConstraintName(columnName);

					const createScript = ddlProvider.createDefaultConstraint(
						{
							constraintName,
							columnName,
							value: newDefaultValue,
						},
						fullName,
					);
					scripts.push(AlterScriptDto.getInstance([createScript], true, false));
					break;
				}
				case defaultValueWasChanged: {
					if (oldConstraintName) {
						const dropScript = ddlProvider.dropConstraint(fullName, oldConstraintName);
						scripts.push(AlterScriptDto.getInstance([dropScript], true, true));
					}
					const constraintName = newConstraintName || getDefaultConstraintName(columnName);

					const createScript = ddlProvider.createDefaultConstraint(
						{
							constraintName,
							columnName,
							value: newDefaultValue,
						},
						fullName,
					);
					scripts.push(AlterScriptDto.getInstance([createScript], true, false));
					break;
				}
				case constraintNameChanged: {
					const dropScript = ddlProvider.dropConstraint(fullName, oldConstraintName);

					const createScript = ddlProvider.createDefaultConstraint(
						{
							constraintName: newConstraintName,
							columnName,
							value: newDefaultValue,
						},
						fullName,
					);
					scripts.push(
						AlterScriptDto.getInstance([dropScript], true, true),
						AlterScriptDto.getInstance([createScript], true, false),
					);
					break;
				}
				default:
					break;
			}
		});

		return scripts;
	};

	return {
		getDefaultValueChangeDto,
	};
};
