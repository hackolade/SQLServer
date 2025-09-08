'use strict';

const { AlterScriptDto } = require('./types/AlterScriptDto');

/**
 * @param relationship {AlterRelationshipDto}
 * @return string
 * */
const getRelationshipName = relationship => {
	return relationship.role.code || relationship.role.name;
};

/**
 * @return {(relationship: AlterRelationshipDto) => string}
 * */
const getFullChildTableName = _ => relationship => {
	const { getNamePrefixedWithSchemaName } = require('../../utils/general')(_);
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
const getAddSingleForeignKeyStatementDto = (ddlProvider, _) => relationship => {
	const compMod = relationship.role.compMod;

	const relationshipName = compMod.code?.new || compMod.name?.new || getRelationshipName(relationship) || '';
	const schemaName = compMod.parent.bucket.name;

	return ddlProvider.createForeignKey(
		{
			name: relationshipName,
			foreignKey: compMod.child.collection.fkFields,
			primaryKey: compMod.parent.collection.fkFields,
			customProperties: compMod.customProperties?.new,
			foreignTable: compMod.child.collection.name,
			foreignSchemaName: compMod.child.bucket.name,
			foreignTableActivated: compMod.child.collection.isActivated,
			primaryTable: compMod.parent.collection.name,
			primarySchemaName: compMod.parent.bucket.name,
			primaryTableActivated: compMod.parent.collection.isActivated,
			isActivated: Boolean(relationship.role?.compMod?.isActivated?.new),
		},
		null,
		{ schemaName },
	);
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
	].every(property => Boolean(property));
};

/**
 * @return {(addedRelationships: Array<AlterRelationshipDto>) => Array<AlterScriptDto>}
 * */
const getAddForeignKeyScriptDtos = (ddlProvider, _) => addedRelationships => {
	return addedRelationships
		.filter(relationship => canRelationshipBeAdded(relationship))
		.map(relationship => {
			const scriptDto = getAddSingleForeignKeyStatementDto(ddlProvider, _)(relationship);
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
const getDeleteSingleForeignKeyStatementDto = (ddlProvider, _) => relationship => {
	const { wrapInBrackets } = require('../../utils/general')(_);
	const compMod = relationship.role.compMod;

	const ddlChildEntityName = getFullChildTableName(_)(relationship);

	const relationshipName = compMod.code?.old || compMod.name?.old || getRelationshipName(relationship) || '';
	const ddlRelationshipName = wrapInBrackets(relationshipName);
	const statement = ddlProvider.dropForeignKey(ddlChildEntityName, ddlRelationshipName);

	const isRelationshipActivated = Boolean(relationship.role?.compMod?.isActivated?.new);
	const isChildTableActivated = compMod.child.collection.isActivated;
	return {
		statement,
		isActivated: isRelationshipActivated && isChildTableActivated,
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
	].every(property => Boolean(property));
};

/**
 * @return {(deletedRelationships: Array<AlterRelationshipDto>) => Array<AlterScriptDto>}
 * */
const getDeleteForeignKeyScriptDtos = (ddlProvider, _) => deletedRelationships => {
	return deletedRelationships
		.filter(relationship => canRelationshipBeDeleted(relationship))
		.map(relationship => {
			const scriptDto = getDeleteSingleForeignKeyStatementDto(ddlProvider, _)(relationship);
			return AlterScriptDto.getInstance([scriptDto.statement], scriptDto.isActivated, true);
		})
		.filter(Boolean)
		.filter(res => res.scripts.some(scriptDto => Boolean(scriptDto.script)));
};

/**
 * @return {(modifiedRelationships: Array<AlterRelationshipDto>) => Array<AlterScriptDto>}
 * */
const getModifyForeignKeyScriptDtos = (ddlProvider, _) => modifiedRelationships => {
	return modifiedRelationships
		.filter(relationship => canRelationshipBeAdded(relationship) && canRelationshipBeDeleted(relationship))
		.map(relationship => {
			const deleteScriptDto = getDeleteSingleForeignKeyStatementDto(ddlProvider, _)(relationship);
			const addScriptDto = getAddSingleForeignKeyStatementDto(ddlProvider, _)(relationship);
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
};
