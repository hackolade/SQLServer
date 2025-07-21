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
	return constraintName || `UQ_${entityName}`;
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

			const statementDto = ddlProvider.addUniqueConstraint(fullTableName, collection.isActivated, keyData, true);

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
 * @return {(collection: AlterCollectionDto) => Array<AlterScriptDto>}
 * */
const getModifyUniqueConstraintsScriptDtos = (app, _, ddlProvider) => collection => {
	const modifyUniqueConstraintScriptDtos = getModifyCompositeUKScriptDtos(app, _, ddlProvider)(collection);

	const sortedDtos = sortModifyUniqueConstraints(modifyUniqueConstraintScriptDtos);

	return sortedDtos
		.map(dto => {
			return AlterScriptDto.getInstance([dto.script], dto.isActivated, dto.isDropScript);
		})
		.filter(Boolean);
};

module.exports = {
	getModifyUniqueConstraintsScriptDtos,
};
