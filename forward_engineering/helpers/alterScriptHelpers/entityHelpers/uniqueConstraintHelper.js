const { AlterScriptDto } = require('../types/AlterScriptDto');

class UniqueConstraintScriptModificationDto {
	/**
	 * @type string
	 * */
	script;

	/**
	 * @type boolean
	 * */
	isDropScript;

	/**
	 * @type {string}
	 * */
	fullTableName;

	/**
	 * @type {boolean}
	 * */
	isActivated;

	/**
	 * @param script {string}
	 * @param fullTableName {string}
	 * @param isDropScript {boolean}
	 * @param isActivated {boolean}
	 * */
	constructor(script, fullTableName, isDropScript, isActivated) {
		this.script = script;
		this.isDropScript = isDropScript;
		this.fullTableName = fullTableName;
		this.isActivated = isActivated;
	}
}

/**
 * @param entityName {string}
 * @param constraintName {string}
 * @return {string}
 * */
const getDefaultUniqueConstraintName = (entityName, constraintName) => {
	return constraintName || `${entityName}_ukey`;
};

/**
 * @param collection {AlterCollectionDto}
 * @return {object}
 * */
const getCollectionNames = (_, collection) => {
	const { getFullCollectionName, getSchemaOfAlterCollection, getEntityName } = require('../../../utils/general')(_);

	const collectionSchema = getSchemaOfAlterCollection(collection);
	const fullTableName = getFullCollectionName(collectionSchema);
	const entityName = getEntityName(collectionSchema);

	return {
		fullTableName,
		entityName,
	};
};

/**
 * @param newConstraints {Array}
 * @param oldConstraints {Array}
 * @return {boolean}
 * */
const areUniqueConstraintsEqual = (_, newConstraints, oldConstraints) => {
	if (newConstraints.length !== oldConstraints.length) {
		return false;
	}
	return _(oldConstraints).differenceWith(newConstraints, _.isEqual).isEmpty();
};

/**
 * @return {(collection: AlterCollectionDto) => Array<UniqueConstraintScriptModificationDto>}
 * */
const getAddCompositeUKScriptDtos = (app, _, ddlProvider) => collection => {
	const { getCompositeUniqueKeys } = require('../../keyHelper')(app);

	const uniqueDto = collection?.role?.compMod?.uniqueKey || {};
	const newUniqueConstraints = uniqueDto.new || [];
	const oldUniqueConstraints = uniqueDto.old || [];

	if (newUniqueConstraints.length === 0 && oldUniqueConstraints.length === 0) {
		return [];
	}

	if (areUniqueConstraintsEqual(_, newUniqueConstraints, oldUniqueConstraints)) {
		return [];
	}

	const { fullTableName, entityName } = getCollectionNames(_, collection);

	return newUniqueConstraints
		.map(newConstraint => {
			const keyData = getCompositeUniqueKeys({ ...collection, ...(collection?.role || {}) }, true)[0];

			if (!keyData) {
				return null;
			}

			const statementDto = ddlProvider.addUniqueConstraint(
				fullTableName,
				collection.isActivated,
				keyData,
				true,
				true,
			);

			return new UniqueConstraintScriptModificationDto(
				statementDto.statement,
				fullTableName,
				false,
				statementDto.isActivated,
			);
		})
		.filter(scriptDto => Boolean(scriptDto?.script));
};

/**
 * @return {(collection: AlterCollectionDto) => Array<UniqueConstraintScriptModificationDto>}
 * */
const getDropCompositeUKScriptDtos = (app, _, ddlProvider) => collection => {
	const { wrapInBrackets } = require('../../../utils/general')(_);

	const uniqueDto = collection?.role?.compMod?.uniqueKey || {};
	const newUniqueConstraints = uniqueDto.new || [];
	const oldUniqueConstraints = uniqueDto.old || [];

	if (newUniqueConstraints.length === 0 && oldUniqueConstraints.length === 0) {
		return [];
	}

	if (areUniqueConstraintsEqual(_, newUniqueConstraints, oldUniqueConstraints)) {
		return [];
	}

	const { fullTableName, entityName } = getCollectionNames(_, collection);

	return oldUniqueConstraints
		.map(oldConstraint => {
			const constraintName = getDefaultUniqueConstraintName(entityName, oldConstraint.constraintName);
			const ddlConstraintName = wrapInBrackets(constraintName);
			const script = ddlProvider.dropUniqueConstraint(fullTableName, ddlConstraintName);

			return new UniqueConstraintScriptModificationDto(script, fullTableName, true, collection.isActivated);
		})
		.filter(scriptDto => Boolean(scriptDto.script));
};

/**
 * @return {(collection: AlterCollectionDto) => Array<UniqueConstraintScriptModificationDto>}
 * */
const getModifyCompositeUKScriptDtos = (app, _, ddlProvider) => collection => {
	const dropUniqueConstraintScriptDtos = getDropCompositeUKScriptDtos(app, _, ddlProvider)(collection);
	const addUniqueConstraintScriptDtos = getAddCompositeUKScriptDtos(app, _, ddlProvider)(collection);

	return [...dropUniqueConstraintScriptDtos, ...addUniqueConstraintScriptDtos].filter(Boolean);
};

/**
 * @param constraintDtos {UniqueConstraintScriptModificationDto[]}
 * @return {UniqueConstraintScriptModificationDto[]}
 * */
const sortModifyUniqueConstraints = constraintDtos => {
	return constraintDtos.sort((c1, c2) => {
		if (c1.fullTableName === c2.fullTableName) {
			// Number(true) = 1, Number(false) = 0;
			// This ensures that DROP script appears before CREATE script
			return Number(c2.isDropScript) - Number(c1.isDropScript);
		}
		// This sorts all statements based on full table name, ASC
		return c1.fullTableName < c2.fullTableName;
	});
};

/**
 * @param entityName {string}
 * @param columnName {string}
 * @return {string}
 * */
const getDefaultUniqueConstraintNameForRegularUK = (entityName, columnName) => {
	return `${entityName}_${columnName}_pkey`;
};

/**
 * @param columnJsonSchema {AlterCollectionColumnDto}
 * @param entityName {string}
 * @param columnName {string}
 * @return {string}
 * */
const getConstraintNameForRegularUK = (columnJsonSchema, entityName, columnName) => {
	if (columnJsonSchema.uniqueKeyOptions?.length > 0) {
		const constraintOption = columnJsonSchema.uniqueKeyOptions[0];
		if (constraintOption.constraintName) {
			return constraintOption.constraintName;
		}
	}
	return getDefaultUniqueConstraintNameForRegularUK(entityName, columnName);
};

/**
 * @return {(columnJsonSchema: AlterCollectionColumnDto, collection: AlterCollectionDto) => boolean}
 * */
const wasFieldChangedToBeARegularUK = _ => (columnJsonSchema, collection) => {
	const oldName = columnJsonSchema.compMod.oldField.name;
	const oldColumnJsonSchema = collection.role.properties[oldName];

	const isRegularUniqueKey = columnJsonSchema.unique && !columnJsonSchema.compositeUniqueKey;
	const wasTheFieldAnyUniqueKey = Boolean(oldColumnJsonSchema?.unique);

	return isRegularUniqueKey && !wasTheFieldAnyUniqueKey;
};

/**
 * @return {(columnJsonSchema: AlterCollectionColumnDto, collection: AlterCollectionDto) => boolean}
 * */
const isFieldNoLongerARegularUK = _ => (columnJsonSchema, collection) => {
	const oldName = columnJsonSchema.compMod.oldField.name;

	const oldJsonSchema = collection.role.properties[oldName];
	const wasTheFieldARegularUniqueKey = oldJsonSchema?.unique && !oldJsonSchema?.compositeUniqueKey;

	const isNotAnyUniqueKey = !columnJsonSchema.unique && !columnJsonSchema.compositeUniqueKey;
	return wasTheFieldARegularUniqueKey && isNotAnyUniqueKey;
};

/**
 * @return {(columnJsonSchema: AlterCollectionColumnDto, collection: AlterCollectionDto) => boolean}
 * */
const wasRegularUKModified = _ => (columnJsonSchema, collection) => {
	const oldName = columnJsonSchema.compMod.oldField.name;
	const oldJsonSchema = collection.role.properties[oldName] || {};

	const isRegularUniqueKey = columnJsonSchema.unique && !columnJsonSchema.compositeUniqueKey;
	const wasTheFieldARegularUniqueKey = oldJsonSchema?.unique && !oldJsonSchema?.compositeUniqueKey;

	if (!(isRegularUniqueKey && wasTheFieldARegularUniqueKey)) {
		return false;
	}

	// Compare unique key options to detect if they changed
	const currentOptions = columnJsonSchema.uniqueKeyOptions || [];
	const oldOptions = oldJsonSchema.uniqueKeyOptions || [];

	const areOptionsEqual = _(oldOptions).differenceWith(currentOptions, _.isEqual).isEmpty();
	return !areOptionsEqual;
};

/**
 * @return {(collection: AlterCollectionDto) => Array<UniqueConstraintScriptModificationDto>}
 * */
const getAddUKScriptDtos = (app, _, ddlProvider) => collection => {
	const { getFullCollectionName, getSchemaOfAlterCollection, getEntityName, wrapInBrackets } =
		require('../../../utils/general')(_);
	const { hydrateUniqueOptions } = require('../../keyHelper')(app);

	const collectionSchema = getSchemaOfAlterCollection(collection);
	const fullTableName = getFullCollectionName(collectionSchema);
	const entityName = getEntityName(collectionSchema);

	return _.toPairs(collection.properties)
		.filter(([name, jsonSchema]) => {
			if (wasFieldChangedToBeARegularUK(_)(jsonSchema, collection)) {
				return true;
			}
			return wasRegularUKModified(_)(jsonSchema, collection);
		})
		.map(([name, jsonSchema]) => {
			let keyData = {
				constraintName: getDefaultUniqueConstraintNameForRegularUK(entityName, name),
				columnName: wrapInBrackets(name),
			};
			const isUKWithOptions = Boolean(jsonSchema.uniqueKeyOptions?.length);

			if (jsonSchema.uniqueKeyOptions) {
				keyData = hydrateUniqueOptions(jsonSchema.uniqueKeyOptions[0], name, jsonSchema.isActivated);
			}

			const statementDto = ddlProvider.addUniqueConstraint(
				fullTableName,
				collection.isActivated,
				keyData,
				isUKWithOptions,
				true,
			);
			return new UniqueConstraintScriptModificationDto(
				statementDto.statement,
				fullTableName,
				false,
				statementDto.isActivated,
			);
		})
		.filter(scriptDto => Boolean(scriptDto.script));
};

/**
 * @return {(collection: AlterCollectionDto) => Array<UniqueConstraintScriptModificationDto>}
 * */
const getDropUKScriptDtos = (_, ddlProvider) => collection => {
	const { getFullCollectionName, getSchemaOfAlterCollection, getEntityName, wrapInBrackets } =
		require('../../../utils/general')(_);

	const collectionSchema = getSchemaOfAlterCollection(collection);
	const fullTableName = getFullCollectionName(collectionSchema);
	const entityName = getEntityName(collectionSchema);

	return _.toPairs(collection.properties)
		.filter(([name, jsonSchema]) => {
			if (isFieldNoLongerARegularUK(_)(jsonSchema, collection)) {
				return true;
			}
			return wasRegularUKModified(_)(jsonSchema, collection);
		})
		.map(([name, jsonSchema]) => {
			const oldName = jsonSchema.compMod.oldField.name;
			const oldJsonSchema = collection.role.properties[oldName];
			const ddlConstraintName = wrapInBrackets(getConstraintNameForRegularUK(oldJsonSchema, entityName, oldName));

			const script = ddlProvider.dropUniqueConstraint(fullTableName, ddlConstraintName);
			return new UniqueConstraintScriptModificationDto(script, fullTableName, true, collection.isActivated);
		})
		.filter(scriptDto => Boolean(scriptDto.script));
};

/**
 * @return {(collection: AlterCollectionDto) => Array<UniqueConstraintScriptModificationDto>}
 * */
const getModifyUKScriptDtos = (app, _, ddlProvider) => collection => {
	const dropUKScriptDtos = getDropUKScriptDtos(_, ddlProvider)(collection);
	const addUKScriptDtos = getAddUKScriptDtos(app, _, ddlProvider)(collection);

	return [...dropUKScriptDtos, ...addUKScriptDtos].filter(Boolean);
};

/**
 * @return {(collection: AlterCollectionDto) => Array<AlterScriptDto>}
 * */
const getModifyUniqueConstraintsScriptDtos = (app, _, ddlProvider) => collection => {
	const modifyCompositeUKScriptDtos = getModifyCompositeUKScriptDtos(app, _, ddlProvider)(collection);
	const modifyUKScriptDtos = getModifyUKScriptDtos(app, _, ddlProvider)(collection);

	const allDtos = [...modifyCompositeUKScriptDtos, ...modifyUKScriptDtos];
	const sortedDtos = sortModifyUniqueConstraints(allDtos);

	return sortedDtos
		.map(dto => {
			return AlterScriptDto.getInstance([dto.script], dto.isActivated, dto.isDropScript);
		})
		.filter(Boolean);
};

module.exports = {
	getModifyUniqueConstraintsScriptDtos,
};
