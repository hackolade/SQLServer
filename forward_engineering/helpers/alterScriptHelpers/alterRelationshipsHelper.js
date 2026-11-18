const { AlterScriptDto } = require('./types/AlterScriptDto');
const { getNamePrefixedWithSchemaName, wrapInBrackets } = require('../../utils/general');

/**
 * @param relationship {AlterRelationshipDto}
 * @return string
 * */
const getRelationshipName = relationship => {
	return relationship.role.code || relationship.role.name;
};

const isRelatedTableActivated = ({ bucket, collection } = {}) => {
	return bucket?.isActivated !== false && collection?.isActivated !== false;
};

const areFkFieldsActivated = fields => (fields || []).every(field => field?.isActivated !== false);

const getFkFieldsForStatement = fields => {
	if (areFkFieldsActivated(fields)) {
		return fields;
	}

	return (fields || []).map(field => ({ ...field, isActivated: true }));
};

const isForeignKeyConstraintActivated = (relationship, isActivated) => {
	const compMod = relationship.role?.compMod;

	return (
		isActivated &&
		isRelatedTableActivated(compMod?.parent) &&
		isRelatedTableActivated(compMod?.child) &&
		areFkFieldsActivated(compMod?.parent?.collection?.fkFields) &&
		areFkFieldsActivated(compMod?.child?.collection?.fkFields)
	);
};

/**
 * @return {(relationship: AlterRelationshipDto) => string}
 * */
const getFullChildTableName = relationship => {
	const compMod = relationship.role.compMod;

	const childBucketName = compMod.child.bucket.name;
	const childEntityName = compMod.child.collection.name;
	return getNamePrefixedWithSchemaName(childEntityName, childBucketName);
};

/**
 * @return {(relationship: AlterRelationshipDto) => {
 *     isActivated: boolean,
 *     statement: string,
 * }}
 * */
const getAddSingleForeignKeyStatementDto = ddlProvider => relationship => {
	const compMod = relationship.role.compMod;

	const relationshipName = compMod.code?.new || compMod.name?.new || getRelationshipName(relationship) || '';
	const schemaName = compMod.parent.bucket.name;

	const statementDto = ddlProvider.createForeignKey(
		{
			name: relationshipName,
			foreignKey: getFkFieldsForStatement(compMod.child.collection.fkFields),
			primaryKey: getFkFieldsForStatement(compMod.parent.collection.fkFields),
			customProperties: compMod.customProperties?.new,
			foreignTable: compMod.child.collection.name,
			foreignSchemaName: compMod.child.bucket.name,
			foreignTableActivated: isRelatedTableActivated(compMod.child),
			primaryTable: compMod.parent.collection.name,
			primarySchemaName: compMod.parent.bucket.name,
			primaryTableActivated: isRelatedTableActivated(compMod.parent),
			isActivated: Boolean(relationship.role?.compMod?.isActivated?.new),
		},
		null,
		{ schemaName },
	);

	return {
		...statementDto,
		isActivated: isForeignKeyConstraintActivated(relationship, statementDto.isActivated),
	};
};

/**
 * @param relationship {AlterRelationshipDto}
 * @return boolean
 * */
const canRelationshipBeAdded = relationship => {
	const compMod = relationship.role.compMod;
	if (!compMod) {
		return false;
	}
	return [
		compMod.parent?.bucket,
		compMod.parent?.collection,
		compMod.parent?.collection?.fkFields?.length,
		compMod.child?.bucket,
		compMod.child?.collection,
		compMod.child?.collection?.fkFields?.length,
	].every(Boolean);
};

/**
 * @return {(addedRelationships: Array<AlterRelationshipDto>) => Array<AlterScriptDto>}
 * */
const getAddForeignKeyScriptDtos = ddlProvider => addedRelationships => {
	return addedRelationships
		.filter(relationship => canRelationshipBeAdded(relationship))
		.map(relationship => {
			const scriptDto = getAddSingleForeignKeyStatementDto(ddlProvider)(relationship);
			return AlterScriptDto.getInstance([scriptDto.statement], scriptDto.isActivated, false);
		})
		.filter(Boolean)
		.filter(res => res.scripts.some(scriptDto => Boolean(scriptDto.script)));
};

/**
 * @return {(relationship: AlterRelationshipDto) => {
 *     isActivated: boolean,
 *     statement: string,
 * }}
 * */
const getDeleteSingleForeignKeyStatementDto = ddlProvider => relationship => {
	const compMod = relationship.role.compMod;

	const ddlChildEntityName = getFullChildTableName(relationship);

	const relationshipName = compMod.code?.old || compMod.name?.old || getRelationshipName(relationship) || '';
	const ddlRelationshipName = wrapInBrackets(relationshipName);
	const statement = ddlProvider.dropForeignKey(ddlChildEntityName, ddlRelationshipName);

	const isRelationshipActivated = Boolean(relationship.role?.compMod?.isActivated?.new);
	const isChildTableActivated = isRelatedTableActivated(compMod.child);
	return {
		statement,
		isActivated: isForeignKeyConstraintActivated(relationship, isRelationshipActivated && isChildTableActivated),
	};
};

/**
 * @param relationship {AlterRelationshipDto}
 * @return {boolean}
 * */
const canRelationshipBeDeleted = relationship => {
	const compMod = relationship.role.compMod;
	if (!compMod) {
		return false;
	}
	return [
		compMod.code?.old || compMod.name?.old || getRelationshipName(relationship),
		compMod.child?.bucket,
		compMod.child?.collection,
	].every(Boolean);
};

/**
 * @return {(deletedRelationships: Array<AlterRelationshipDto>) => Array<AlterScriptDto>}
 * */
const getDeleteForeignKeyScriptDtos = ddlProvider => deletedRelationships => {
	return deletedRelationships
		.filter(relationship => canRelationshipBeDeleted(relationship))
		.map(relationship => {
			const scriptDto = getDeleteSingleForeignKeyStatementDto(ddlProvider)(relationship);
			return AlterScriptDto.getInstance([scriptDto.statement], scriptDto.isActivated, true);
		})
		.filter(Boolean)
		.filter(res => res.scripts.some(scriptDto => Boolean(scriptDto.script)));
};

/**
 * @return {(modifiedRelationships: Array<AlterRelationshipDto>) => Array<AlterScriptDto>}
 * */
const getModifyForeignKeyScriptDtos = ddlProvider => modifiedRelationships => {
	return modifiedRelationships
		.filter(relationship => canRelationshipBeAdded(relationship) && canRelationshipBeDeleted(relationship))
		.map(relationship => {
			const deleteScriptDto = getDeleteSingleForeignKeyStatementDto(ddlProvider)(relationship);
			const addScriptDto = getAddSingleForeignKeyStatementDto(ddlProvider)(relationship);
			const isActivated = addScriptDto.isActivated && deleteScriptDto.isActivated;
			return AlterScriptDto.getDropAndRecreateInstance(
				deleteScriptDto.statement,
				addScriptDto.statement,
				isActivated,
			);
		})
		.filter(Boolean)
		.filter(res => res.scripts.some(scriptDto => Boolean(scriptDto.script)));
};

module.exports = {
	getDeleteForeignKeyScriptDtos,
	getModifyForeignKeyScriptDtos,
	getAddForeignKeyScriptDtos,
	getRelationshipName,
	isRelatedTableActivated,
};
