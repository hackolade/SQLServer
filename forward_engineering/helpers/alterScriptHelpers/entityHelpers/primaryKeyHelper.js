const _ = require('lodash');
const { AlterScriptDto } = require('../types/AlterScriptDto');
const { getCompositePrimaryKeys, hydratePrimaryKeyOptions } = require('../../keyHelper');
const {
	wrapInBrackets,
	getSchemaOfAlterCollection,
	getFullCollectionName,
	getEntityName,
	buildDefaultPKName,
} = require('../../../utils/general');

const amountOfColumnsInRegularPk = 1;

class PkTransitionDto {
	/**
	 * @type {boolean}
	 * */
	didTransitionHappen;

	/**
	 * @type {boolean | undefined}
	 * */
	wasPkChangedInTransition;

	/**
	 * @return {PkTransitionDto}
	 * */
	static noTransition() {
		return {
			didTransitionHappen: false,
		};
	}

	/**
	 * @param wasPkChangedInTransition {boolean}
	 * @return {PkTransitionDto}
	 * */
	static transition(wasPkChangedInTransition) {
		return {
			didTransitionHappen: true,
			wasPkChangedInTransition,
		};
	}
}

class PkScriptModificationDto {
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
	 * @param fullTableName {string}
	 * @param script {string}
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
 * @return {string}
 * */
const getDefaultConstraintName = entityName => {
	return `${entityName}_pkey`;
};

/**
 * @param optionHolder {AlterCollectionColumnPrimaryKeyOptionDto}
 * @return {<Partial<AlterCollectionColumnPrimaryKeyOptionDto>}
 * */
const extractOptionsForComparisonWithRegularPkOptions = optionHolder => {
	return {
		constraintName: optionHolder.constraintName,
		indexStorageParameters: optionHolder.indexStorageParameters,
		indexTablespace: optionHolder.indexTablespace,
		indexInclude: optionHolder.indexInclude,
	};
};

/**
 * @param primaryKeyOptions {AlterCollectionColumnPrimaryKeyOptionDto[] | AlterCollectionColumnPrimaryKeyOptionDto | undefined}
 * @return {AlterCollectionColumnPrimaryKeyOptionDto[]}
 */
const getPrimaryKeyOptionsArray = primaryKeyOptions => {
	if (Array.isArray(primaryKeyOptions)) {
		return primaryKeyOptions;
	} else if (typeof primaryKeyOptions === 'object') {
		return [primaryKeyOptions];
	} else {
		return [];
	}
};

/**
 * @param columnJsonSchema {AlterCollectionColumnDto}
 * @return {Array<Partial<AlterCollectionColumnPrimaryKeyOptionDto>>}
 * */
const getCustomPropertiesOfRegularPkForComparisonWithRegularPkOptions = columnJsonSchema => {
	/**
	 * @type {Array<AlterCollectionColumnPrimaryKeyOptionDto>}
	 * */
	const constraintOptions = getPrimaryKeyOptionsArray(columnJsonSchema.primaryKeyOptions);
	return constraintOptions.map(option => extractOptionsForComparisonWithRegularPkOptions(option));
};

/**
 * @param compositePk {AlterCollectionRoleCompModPKDto}
 * @return {Array<Partial<AlterCollectionColumnPrimaryKeyOptionDto>>}
 * */
const getCustomPropertiesOfCompositePkForComparisonWithRegularPkOptions = compositePk => {
	const optionsForComparison = extractOptionsForComparisonWithRegularPkOptions(compositePk);
	return [optionsForComparison].filter(o => Object.values(o).some(Boolean));
};

/**
 * @return {(collection: AlterCollectionDto) => PkTransitionDto}
 * */
const wasCompositePkChangedInTransitionFromCompositeToRegular = collection => {
	/**
	 * @type {AlterCollectionRoleCompModPrimaryKey}
	 * */
	const pkDto = collection?.role?.compMod?.primaryKey || {};
	/**
	 * @type {AlterCollectionRoleCompModPKDto[]}
	 * */
	const oldPrimaryKeys = pkDto.old || [];
	const idsOfColumns = oldPrimaryKeys.flatMap(pk => pk.compositePrimaryKey.map(dto => dto.keyId));
	if (idsOfColumns.length !== amountOfColumnsInRegularPk) {
		// We return false, because it wouldn't count as transition between regular PK and composite PK
		// if composite PK did not constraint exactly 1 column
		return PkTransitionDto.noTransition();
	}
	const idOfPkColumn = idsOfColumns[0];
	const newColumnJsonSchema = Object.values(collection.role.properties).find(
		columnJsonSchema => columnJsonSchema.GUID === idOfPkColumn,
	);
	if (!newColumnJsonSchema) {
		return PkTransitionDto.noTransition();
	}
	const isNewColumnARegularPrimaryKey = newColumnJsonSchema?.primaryKey && !newColumnJsonSchema?.compositePrimaryKey;
	if (!isNewColumnARegularPrimaryKey) {
		return PkTransitionDto.noTransition();
	}
	const constraintOptions = getCustomPropertiesOfRegularPkForComparisonWithRegularPkOptions(newColumnJsonSchema);
	const areOptionsEqual = oldPrimaryKeys.some(compositePk => {
		if (compositePk.compositePrimaryKey.length !== amountOfColumnsInRegularPk) {
			return false;
		}
		const oldCompositePkAsRegularPkOptions =
			getCustomPropertiesOfCompositePkForComparisonWithRegularPkOptions(compositePk);
		return _(oldCompositePkAsRegularPkOptions).differenceWith(constraintOptions, _.isEqual).isEmpty();
	});

	return PkTransitionDto.transition(!areOptionsEqual);
};

/**
 * @return {(collection: AlterCollectionDto) => PkTransitionDto}
 * */
const wasCompositePkChangedInTransitionFromRegularToComposite = collection => {
	/**
	 * @type {AlterCollectionRoleCompModPrimaryKey}
	 * */
	const pkDto = collection?.role?.compMod?.primaryKey || {};
	/**
	 * @type {AlterCollectionRoleCompModPKDto[]}
	 * */
	const newPrimaryKeys = pkDto.new || [];
	const idsOfColumns = newPrimaryKeys.flatMap(pk => pk.compositePrimaryKey.map(dto => dto.keyId));
	if (idsOfColumns.length !== amountOfColumnsInRegularPk) {
		// We return false, because it wouldn't count as transition between regular PK and composite PK
		// if composite PK does not constraint exactly 1 column
		return PkTransitionDto.noTransition();
	}
	const idOfPkColumn = idsOfColumns[0];
	const oldColumnJsonSchema = Object.values(collection.role.properties).find(
		columnJsonSchema => columnJsonSchema.GUID === idOfPkColumn,
	);
	if (!oldColumnJsonSchema) {
		return PkTransitionDto.noTransition();
	}
	const isOldColumnARegularPrimaryKey = oldColumnJsonSchema?.primaryKey && !oldColumnJsonSchema?.compositePrimaryKey;
	if (!isOldColumnARegularPrimaryKey) {
		return PkTransitionDto.noTransition();
	}
	const constraintOptions = getCustomPropertiesOfRegularPkForComparisonWithRegularPkOptions(oldColumnJsonSchema);
	const areOptionsEqual = newPrimaryKeys.some(compositePk => {
		if (compositePk.compositePrimaryKey.length !== amountOfColumnsInRegularPk) {
			return false;
		}
		const oldCompositePkAsRegularPkOptions =
			getCustomPropertiesOfCompositePkForComparisonWithRegularPkOptions(compositePk);
		return _(oldCompositePkAsRegularPkOptions).differenceWith(constraintOptions, _.isEqual).isEmpty();
	});

	return PkTransitionDto.transition(!areOptionsEqual);
};

const checkCompositePKsOnTransition = transitionToCompositeDto => {
	return !!(transitionToCompositeDto.didTransitionHappen && !transitionToCompositeDto.wasPkChangedInTransition);
};

const checkCompositePKsOnEquality = (newPrimaryKeys, oldPrimaryKeys) => {
	if (newPrimaryKeys.length === oldPrimaryKeys.length) {
		const areKeyArraysEqual = _(oldPrimaryKeys).differenceWith(newPrimaryKeys, _.isEqual).isEmpty();

		if (areKeyArraysEqual) {
			return true;
		}
	}

	return false;
};

const checkCompositePKsOnTransitionOrEquality = (transitionToCompositeDto, newPrimaryKeys, oldPrimaryKeys) => {
	return (
		checkCompositePKsOnTransition(transitionToCompositeDto) ||
		checkCompositePKsOnEquality(newPrimaryKeys, oldPrimaryKeys)
	);
};

const getCollectionNames = collection => {
	const collectionSchema = getSchemaOfAlterCollection(collection);
	const fullTableName = getFullCollectionName(collectionSchema);
	const entityName = getEntityName(collectionSchema);

	return {
		fullTableName,
		entityName,
	};
};

/**
 * @return {(collection: AlterCollectionDto) => Array<PkScriptModificationDto>}
 * */
const getAddCompositePkScriptDtos = ddlProvider => collection => {
	/**
	 * @type {AlterCollectionRoleCompModPrimaryKey}
	 * */
	const pkDto = collection?.role?.compMod?.primaryKey || {};
	const newPrimaryKeys = pkDto.new || [];
	const oldPrimaryKeys = pkDto.old || [];
	if (newPrimaryKeys.length === 0 && oldPrimaryKeys.length === 0) {
		return [];
	}
	const transitionToCompositeDto = wasCompositePkChangedInTransitionFromRegularToComposite(collection);

	if (checkCompositePKsOnTransitionOrEquality(transitionToCompositeDto, newPrimaryKeys, oldPrimaryKeys)) {
		return [];
	}

	const { fullTableName } = getCollectionNames(collection);

	return newPrimaryKeys
		.map(_ => getCompositePrimaryKeys({ ...collection, ...collection?.role }, true)[0])
		.filter(Boolean)
		.map(keyData => {
			const statementDto = ddlProvider.addPKConstraint(
				fullTableName,
				collection.isActivated,
				keyData,
				true,
				true,
			);
			return new PkScriptModificationDto(statementDto.statement, fullTableName, false, statementDto.isActivated);
		})
		.filter(scriptDto => Boolean(scriptDto.script));
};

/**
 * @return {(collection: AlterCollectionDto) => Array<PkScriptModificationDto>}
 * */
const getDropCompositePkScriptDtos = ddlProvider => collection => {
	const pkDto = collection?.role?.compMod?.primaryKey || {};
	const newPrimaryKeys = pkDto.new || [];
	const oldPrimaryKeys = pkDto.old || [];
	if (newPrimaryKeys.length === 0 && oldPrimaryKeys.length === 0) {
		return [];
	}
	const transitionToCompositeDto = wasCompositePkChangedInTransitionFromCompositeToRegular(collection);

	if (checkCompositePKsOnTransitionOrEquality(transitionToCompositeDto, newPrimaryKeys, oldPrimaryKeys)) {
		return [];
	}

	const { fullTableName, entityName } = getCollectionNames(collection);

	return oldPrimaryKeys
		.map(oldPk => {
			let constraintName = getDefaultConstraintName(entityName);
			if (oldPk.constraintName) {
				constraintName = oldPk.constraintName;
			}
			const ddlConstraintName = wrapInBrackets(constraintName);
			const script = ddlProvider.dropPKConstraint(fullTableName, ddlConstraintName);
			return new PkScriptModificationDto(script, fullTableName, true, collection.isActivated);
		})
		.filter(scriptDto => Boolean(scriptDto.script));
};

/**
 * @return {(collection: AlterCollectionDto) => Array<PkScriptModificationDto>}
 * */
const getModifyCompositePkScriptDtos = ddlProvider => collection => {
	const dropCompositePkScriptDtos = getDropCompositePkScriptDtos(ddlProvider)(collection);
	const addCompositePkScriptDtos = getAddCompositePkScriptDtos(ddlProvider)(collection);

	return [...dropCompositePkScriptDtos, ...addCompositePkScriptDtos].filter(Boolean);
};

/**
 * @param columnJsonSchema {AlterCollectionColumnDto}
 * @param entityName {string}
 * @return {string}
 * */
const getConstraintNameForRegularPk = (columnJsonSchema, entityName) => {
	const constraintOptions = getPrimaryKeyOptionsArray(columnJsonSchema.primaryKeyOptions);
	if (constraintOptions?.length && constraintOptions?.length > 0) {
		/**
		 * @type {AlterCollectionColumnPrimaryKeyOptionDto}
		 * */
		const constraintOption = constraintOptions[0];
		if (constraintOption.constraintName) {
			return constraintOption.constraintName;
		}
	}
	return getDefaultConstraintName(entityName);
};

/**
 * @return {(columnJsonSchema: AlterCollectionColumnDto, collection: AlterCollectionDto) => boolean}
 * */
const wasFieldChangedToBeARegularPk = (columnJsonSchema, collection) => {
	const oldName = columnJsonSchema.compMod.oldField.name;
	const oldColumnJsonSchema = collection.role.properties[oldName];

	const isRegularPrimaryKey = columnJsonSchema.primaryKey && !columnJsonSchema.compositePrimaryKey;
	const wasTheFieldAnyPrimaryKey = Boolean(oldColumnJsonSchema?.primaryKey);

	return isRegularPrimaryKey && !wasTheFieldAnyPrimaryKey;
};

/**
 * @return {(columnJsonSchema: AlterCollectionColumnDto, collection: AlterCollectionDto) => PkTransitionDto}
 * */
const wasRegularPkChangedInTransitionFromCompositeToRegular = (columnJsonSchema, collection) => {
	const oldName = columnJsonSchema.compMod.oldField.name;
	const oldColumnJsonSchema = collection.role.properties[oldName];

	const isRegularPrimaryKey = columnJsonSchema.primaryKey && !columnJsonSchema.compositePrimaryKey;
	const wasTheFieldAnyPrimaryKey = Boolean(oldColumnJsonSchema?.primaryKey);

	if (!(isRegularPrimaryKey && wasTheFieldAnyPrimaryKey)) {
		return PkTransitionDto.noTransition();
	}

	/**
	 * @type {AlterCollectionRoleCompModPrimaryKey}
	 * */
	const pkDto = collection?.role?.compMod?.primaryKey || {};
	const newPrimaryKeys = pkDto.new || [];
	/**
	 * @type {AlterCollectionRoleCompModPKDto[]}
	 * */
	const oldPrimaryKeys = pkDto.old || [];
	const wasTheFieldACompositePrimaryKey = oldPrimaryKeys.some(compPk =>
		compPk.compositePrimaryKey.some(pk => pk.keyId === oldColumnJsonSchema.GUID),
	);
	const isTheFieldACompositePrimaryKey = newPrimaryKeys.some(compPk =>
		compPk.compositePrimaryKey.some(pk => pk.keyId === columnJsonSchema.GUID),
	);

	const wasCompositePkRemoved = wasTheFieldACompositePrimaryKey && !isTheFieldACompositePrimaryKey;

	if (isRegularPrimaryKey && wasCompositePkRemoved) {
		// return compare custom properties and amount of columns.
		// If there was a transition and amount of composite PK columns is not equal
		// to amount of regular pk columns, we must recreate PK
		const constraintOptions = getCustomPropertiesOfRegularPkForComparisonWithRegularPkOptions(columnJsonSchema);
		const areOptionsEqual = oldPrimaryKeys.some(oldCompositePk => {
			if (oldCompositePk.compositePrimaryKey.length !== amountOfColumnsInRegularPk) {
				return false;
			}
			const oldCompositePkAsRegularPkOptions =
				getCustomPropertiesOfCompositePkForComparisonWithRegularPkOptions(oldCompositePk);
			return _(oldCompositePkAsRegularPkOptions).differenceWith(constraintOptions, _.isEqual).isEmpty();
		});
		return PkTransitionDto.transition(!areOptionsEqual);
	}

	return PkTransitionDto.noTransition();
};

/**
 * @return {(columnJsonSchema: AlterCollectionColumnDto, collection: AlterCollectionDto) => PkTransitionDto}
 * */
const wasRegularPkChangedInTransitionFromRegularToComposite = (columnJsonSchema, collection) => {
	const oldName = columnJsonSchema.compMod.oldField.name;
	const oldColumnJsonSchema = collection.role.properties[oldName];

	const wasRegularPrimaryKey = oldColumnJsonSchema.primaryKey && !oldColumnJsonSchema.compositePrimaryKey;
	const isTheFieldAnyPrimaryKey = Boolean(columnJsonSchema?.primaryKey);

	if (!(wasRegularPrimaryKey && isTheFieldAnyPrimaryKey)) {
		return PkTransitionDto.noTransition();
	}

	/**
	 * @type {AlterCollectionRoleCompModPrimaryKey}
	 * */
	const pkDto = collection?.role?.compMod?.primaryKey || {};
	const newPrimaryKeys = pkDto.new || [];
	/**
	 * @type {AlterCollectionRoleCompModPKDto[]}
	 * */
	const oldPrimaryKeys = pkDto.old || [];
	const wasTheFieldACompositePrimaryKey = oldPrimaryKeys.some(compPk =>
		compPk.compositePrimaryKey.some(pk => pk.keyId === oldColumnJsonSchema.GUID),
	);
	const isTheFieldACompositePrimaryKey = newPrimaryKeys.some(compPk =>
		compPk.compositePrimaryKey.some(pk => pk.keyId === columnJsonSchema.GUID),
	);

	const wasCompositePkAdded = isTheFieldACompositePrimaryKey && !wasTheFieldACompositePrimaryKey;

	if (wasRegularPrimaryKey && wasCompositePkAdded) {
		// return compare custom properties and amount of columns.
		// If there was a transition and amount of composite PK columns is not equal
		// to amount of regular pk columns, we must recreate PK
		const constraintOptions = getCustomPropertiesOfRegularPkForComparisonWithRegularPkOptions(oldColumnJsonSchema);
		const areOptionsEqual = newPrimaryKeys.some(oldCompositePk => {
			if (oldCompositePk.compositePrimaryKey.length !== amountOfColumnsInRegularPk) {
				return false;
			}
			const oldCompositePkAsRegularPkOptions =
				getCustomPropertiesOfCompositePkForComparisonWithRegularPkOptions(oldCompositePk);
			return _(oldCompositePkAsRegularPkOptions).differenceWith(constraintOptions, _.isEqual).isEmpty();
		});
		return PkTransitionDto.transition(!areOptionsEqual);
	}

	return PkTransitionDto.noTransition();
};

/**
 * @return {(columnJsonSchema: AlterCollectionColumnDto, collection: AlterCollectionDto) => boolean}
 * */
const isFieldNoLongerARegularPk = (columnJsonSchema, collection) => {
	const oldName = columnJsonSchema.compMod.oldField.name;

	const oldJsonSchema = collection.role.properties[oldName];
	const wasTheFieldARegularPrimaryKey = oldJsonSchema?.primaryKey && !oldJsonSchema?.compositePrimaryKey;

	const isNotAnyPrimaryKey = !columnJsonSchema.primaryKey && !columnJsonSchema.compositePrimaryKey;
	return wasTheFieldARegularPrimaryKey && isNotAnyPrimaryKey;
};

/**
 * @return {(columnJsonSchema: AlterCollectionColumnDto, collection: AlterCollectionDto) => boolean}
 * */
const wasRegularPkModified = (columnJsonSchema, collection) => {
	const oldName = columnJsonSchema.compMod.oldField.name;
	const oldJsonSchema = collection.role.properties[oldName] || {};

	const isRegularPrimaryKey = columnJsonSchema.primaryKey && !columnJsonSchema.compositePrimaryKey;
	const wasTheFieldARegularPrimaryKey = oldJsonSchema?.primaryKey && !oldJsonSchema?.compositePrimaryKey;

	if (!(isRegularPrimaryKey && wasTheFieldARegularPrimaryKey)) {
		return false;
	}
	const constraintOptions = getCustomPropertiesOfRegularPkForComparisonWithRegularPkOptions(columnJsonSchema);
	const oldConstraintOptions = getCustomPropertiesOfRegularPkForComparisonWithRegularPkOptions(oldJsonSchema);
	const areOptionsEqual = _(oldConstraintOptions).differenceWith(constraintOptions, _.isEqual).isEmpty();
	return !areOptionsEqual;
};

/**
 * @return {(collection: AlterCollectionDto) => Array<PkScriptModificationDto>}
 * */
const getAddPkScriptDtos = ddlProvider => collection => {
	const collectionSchema = getSchemaOfAlterCollection(collection);
	const fullTableName = getFullCollectionName(collectionSchema);
	const entityName = getEntityName(collectionSchema);

	return _.toPairs(collection.properties)
		.filter(([name, jsonSchema]) => {
			if (wasFieldChangedToBeARegularPk(jsonSchema, collection)) {
				return true;
			}
			const transitionToRegularDto = wasRegularPkChangedInTransitionFromCompositeToRegular(
				jsonSchema,
				collection,
			);
			if (transitionToRegularDto.didTransitionHappen) {
				return transitionToRegularDto.wasPkChangedInTransition;
			}
			return wasRegularPkModified(jsonSchema, collection);
		})
		.map(([name, jsonSchema]) => {
			let keyData = {
				constraintName: buildDefaultPKName(entityName, name),
				columnName: wrapInBrackets(name),
			};
			const isPKWithOptions = Boolean(jsonSchema.primaryKeyOptions);

			if (jsonSchema.primaryKeyOptions) {
				keyData = hydratePrimaryKeyOptions(jsonSchema.primaryKeyOptions, name, jsonSchema.isActivated);
			}

			const statementDto = ddlProvider.addPKConstraint(
				fullTableName,
				collection.isActivated,
				keyData,
				isPKWithOptions,
				true,
			);
			return new PkScriptModificationDto(statementDto.statement, fullTableName, false, statementDto.isActivated);
		})
		.filter(scriptDto => Boolean(scriptDto.script));
};

/**
 * @return {(collection: AlterCollectionDto) => Array<PkScriptModificationDto>}
 * */
const getDropPkScriptDto = ddlProvider => collection => {
	const collectionSchema = getSchemaOfAlterCollection(collection);
	const fullTableName = getFullCollectionName(collectionSchema);
	const entityName = getEntityName(collectionSchema);

	return _.toPairs(collection.properties)
		.filter(([name, jsonSchema]) => {
			if (isFieldNoLongerARegularPk(jsonSchema, collection)) {
				return true;
			}
			const transitionToRegularDto = wasRegularPkChangedInTransitionFromRegularToComposite(
				jsonSchema,
				collection,
			);
			if (transitionToRegularDto.didTransitionHappen) {
				return transitionToRegularDto.wasPkChangedInTransition;
			}
			return wasRegularPkModified(jsonSchema, collection);
		})
		.map(([name, jsonSchema]) => {
			const oldName = jsonSchema.compMod.oldField.name;
			const oldJsonSchema = collection.role.properties[oldName];
			const ddlConstraintName = wrapInBrackets(getConstraintNameForRegularPk(oldJsonSchema, entityName));

			const script = ddlProvider.dropPKConstraint(fullTableName, ddlConstraintName);
			return new PkScriptModificationDto(script, fullTableName, true, collection.isActivated);
		})
		.filter(scriptDto => Boolean(scriptDto.script));
};

/**
 * @return {(collection: AlterCollectionDto) => Array<PkScriptModificationDto>}
 * */
const getModifyPkScriptDtos = ddlProvider => collection => {
	const dropPkScriptDtos = getDropPkScriptDto(ddlProvider)(collection);
	const addPkScriptDtos = getAddPkScriptDtos(ddlProvider)(collection);

	return [...dropPkScriptDtos, ...addPkScriptDtos].filter(Boolean);
};

/**
 * @param constraintDtos {PkScriptModificationDto[]}
 * @return {PkScriptModificationDto[]}
 * */
const sortModifyPkConstraints = constraintDtos => {
	return constraintDtos.sort((c1, c2) => {
		if (c1.fullTableName === c2.fullTableName) {
			// Number(true) = 1, Number(false) = 0;
			// This ensures that DROP script appears before CREATE script
			// if the same table has 2 scripts that drop and recreate PK
			return Number(c2.isDropScript) - Number(c1.isDropScript);
		}
		// This sorts all statements based on full table name, ASC
		return c1.fullTableName < c2.fullTableName;
	});
};

/**
 * @return {(collection: AlterCollectionDto) => Array<AlterScriptDto>}
 * */
const getModifyPkConstraintsScriptDtos = ddlProvider => collection => {
	const modifyCompositePkScriptDtos = getModifyCompositePkScriptDtos(ddlProvider)(collection);
	const modifyPkScriptDtos = getModifyPkScriptDtos(ddlProvider)(collection);

	const allDtos = [...modifyCompositePkScriptDtos, ...modifyPkScriptDtos];
	const sortedAllDtos = sortModifyPkConstraints(allDtos);

	return sortedAllDtos
		.map(dto => {
			return AlterScriptDto.getInstance([dto.script], dto.isActivated, dto.isDropScript);
		})
		.filter(Boolean);
};

module.exports = {
	getModifyPkConstraintsScriptDtos,
};
