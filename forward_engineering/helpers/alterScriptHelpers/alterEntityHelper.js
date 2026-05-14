const _ = require('lodash');
const { AlterScriptDto } = require('./types/AlterScriptDto');
const { getRelationshipName } = require('./alterRelationshipsHelper');
const { getEntityName, getFullTableName } = require('../../utils/general');
const { createColumnDefinitionBySchema } = require('./columnHelpers/createColumnDefinition');
const { modifyGroupItems, setIndexKeys } = require('./common');
const { getTableName } = require('../general');

const alterEntityHelper = (app, options) => {
	const ddlProvider = require('../../ddlProvider')(null, options, app);

	const { generateIdToNameHashTable, generateIdToActivatedHashTable } = app.require('@hackolade/ddl-fe-utils');

	const { getRenameColumnScriptsDto } = require('./columnHelpers/renameColumnHelpers')(ddlProvider);
	const { getDefaultValueChangeDto } = require('./columnHelpers/defaultValueColumnHelper')(ddlProvider);
	const { getChangedComputedColumnsScriptsDto } = require('./columnHelpers/alterComputedColumnHelper')(ddlProvider);
	const { getChangeTypeScriptsDto } = require('./columnHelpers/alterTypeHelper')(ddlProvider, options);
	const { getModifyCheckConstraintScriptDtos } = require('./entityHelpers/checkConstraintHelper');
	const { getModifyPkConstraintsScriptDtos } = require('./entityHelpers/primaryKeyHelper');
	const { getModifyNonNullColumnsScriptDtos } = require('./columnHelpers/notNullConstraintsHelper');
	const { getModifyUniqueConstraintsScriptDtos } = require('./entityHelpers/uniqueConstraintHelper');

	/**
	 * @param {Collection} collection
	 * @param inlineDeltaRelationships
	 * @return Array<AlterScriptDto>
	 * */
	const getAddCollectionScriptDto = (collection, inlineDeltaRelationships) => {
		//done but need clean up
		const schemaName = collection.compMod.keyspaceName;
		const schemaData = { schemaName, dbVersion: options.dbVersion };
		const jsonSchema = { ...collection, ...collection?.role };
		const tableName = getEntityName(jsonSchema);
		const idToNameHashTable = generateIdToNameHashTable(jsonSchema);
		const idToActivatedHashTable = generateIdToActivatedHashTable(jsonSchema);
		const columnDefinitions = _.toPairs(jsonSchema.properties).map(([name, column]) =>
			createColumnDefinitionBySchema({
				name,
				jsonSchema: column,
				parentJsonSchema: jsonSchema,
				ddlProvider,
				schemaData,
			}),
		);
		const checkConstraints = (jsonSchema.chkConstr || []).map(check =>
			ddlProvider.createCheckConstraint(ddlProvider.hydrateCheckConstraint(check)),
		);

		const foreignKeyConstraints = inlineDeltaRelationships
			.filter(relationship => relationship.role.childCollection === collection.role.id)
			.map(relationship => {
				const compMod = relationship.role.compMod;
				const relationshipName =
					compMod.code?.new || compMod.name?.new || getRelationshipName(relationship) || '';
				return ddlProvider.createForeignKeyConstraint({
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
				});
			});

		const tableData = {
			name: tableName,
			columns: columnDefinitions.map(ddlProvider.convertColumnDefinition),
			checkConstraints: checkConstraints,
			foreignKeyConstraints,
			schemaData,
			columnDefinitions,
		};

		const indexesScripts = (jsonSchema.Indxs || [])
			.map(hydrateIndex({ idToNameHashTable, idToActivatedHashTable, ddlProvider, tableData, schemaData }))
			.map(index => _.trim(ddlProvider.createIndex(tableName, index, null, jsonSchema.isActivated)));

		const hydratedTable = ddlProvider.hydrateTable({
			tableData,
			entityData: [jsonSchema],
			jsonSchema,
			idToNameHashTable,
		});
		const tableScriptDto = AlterScriptDto.getInstance(
			[ddlProvider.createTable(hydratedTable, jsonSchema.isActivated)],
			true,
			false,
		);
		const indexesScriptsDto = indexesScripts
			.map(indexScript => AlterScriptDto.getInstance([indexScript], true, false))
			.filter(Boolean);

		return [tableScriptDto, ...indexesScriptsDto].filter(Boolean);
	};

	/**
	 * @param {Collection} collection
	 * @return {AlterScriptDto}
	 * */
	const getDeleteCollectionScriptDto = collection => {
		const fullName = getFullTableName(collection);
		const script = ddlProvider.dropTable(fullName);

		return AlterScriptDto.getInstance([script], true, true);
	};

	/**
	 * @param {Collection} collection
	 * @return {Array<AlterScriptDto>}
	 * */
	const getModifyCollectionScriptDto = collection => {
		const jsonSchema = { ...collection, ...collection?.role };
		const schemaName = collection.compMod?.keyspaceName;
		const schemaData = { schemaName, dbVersion: options.dbVersion };
		const idToNameHashTable = generateIdToNameHashTable(jsonSchema);
		const idToActivatedHashTable = generateIdToActivatedHashTable(jsonSchema);
		const modifyCheckConstraintScriptDtos = getModifyCheckConstraintScriptDtos(ddlProvider)(collection);
		const modifyUniqueConstraintsScriptDtos = getModifyUniqueConstraintsScriptDtos(ddlProvider)(collection);
		const modifyPKConstraintDtos = getModifyPkConstraintsScriptDtos(ddlProvider)(collection);
		const indexesScriptsDtos = modifyGroupItems({
			data: jsonSchema,
			key: 'Indxs',
			hydrate: hydrateIndex({
				idToNameHashTable,
				idToActivatedHashTable,
				ddlProvider,
				schemaData,
				tableData: [jsonSchema],
			}),
			create: (tableName, index) =>
				index.orReplace
					? [
							AlterScriptDto.getInstance([ddlProvider.dropIndex(tableName, index)], true, true),
							AlterScriptDto.getInstance([ddlProvider.createIndex(tableName, index, null)], true, false),
						]
					: AlterScriptDto.getInstance([ddlProvider.createIndex(tableName, index, schemaData)], true, false),
			drop: (tableName, index) =>
				AlterScriptDto.getInstance([ddlProvider.dropIndex(tableName, index)], true, true),
		}).flat();

		return [
			...modifyCheckConstraintScriptDtos,
			...modifyPKConstraintDtos,
			...modifyUniqueConstraintsScriptDtos,
			...indexesScriptsDtos,
		].filter(Boolean);
	};

	/**
	 * @param {Collection} collection
	 * @return {Array<AlterScriptDto> | undefined}
	 * */
	const getAddColumnScriptDto = collection => {
		const collectionSchema = { ...collection, ..._.omit(collection?.role, 'properties') };
		const tableName = collectionSchema?.code || collectionSchema?.collectionName || collectionSchema?.name;
		const schemaName = collectionSchema.compMod?.keyspaceName;
		const fullName = getTableName(tableName, schemaName);
		const schemaData = { schemaName, dbVersion: options.dbVersion };

		return _.toPairs(collection.properties)
			.filter(([name, jsonSchema]) => !jsonSchema.compMod)
			.map(([name, jsonSchema]) => {
				const columnDefinition = createColumnDefinitionBySchema({
					name,
					jsonSchema,
					parentJsonSchema: collectionSchema,
					ddlProvider,
					schemaData,
				});

				const columnDefinitionScript = ddlProvider.convertColumnDefinition(columnDefinition);
				const script = ddlProvider.addColumn(fullName, columnDefinitionScript);

				return AlterScriptDto.getInstance([script], true, false);
			});
	};

	/**
	 * @param {Collection} collection
	 * @return {Array<AlterScriptDto> | undefined}
	 * */
	const getDeleteColumnScriptDto = collection => {
		const collectionSchema = { ...collection, ..._.omit(collection?.role, 'properties') };
		const tableName = collectionSchema?.code || collectionSchema?.collectionName || collectionSchema?.name;
		const schemaName = collectionSchema.compMod?.keyspaceName;
		const fullName = getTableName(tableName, schemaName);

		return _.toPairs(collection.properties)
			.filter(([name, jsonSchema]) => !jsonSchema.compMod)
			.map(([name]) => {
				const script = ddlProvider.dropColumn(fullName, name);

				return AlterScriptDto.getInstance([script], true, true);
			})
			.filter(Boolean);
	};

	/**
	 * @param {Collection} collection
	 * @return {Array<AlterScriptDto> | undefined}
	 * */
	const getModifyColumnScriptDto = collection => {
		const collectionSchema = { ...collection, ..._.omit(collection?.role, 'properties') };
		const tableName = collectionSchema?.code || collectionSchema?.collectionName || collectionSchema?.name;
		const schemaName = collectionSchema.compMod?.keyspaceName;
		const fullName = getTableName(tableName, schemaName);

		const renameColumnScriptsDtos = getRenameColumnScriptsDto(collection.properties, fullName);
		const changeTypeScriptsDtos = getChangeTypeScriptsDto(
			collection.properties,
			fullName,
			collectionSchema,
			schemaName,
		);
		const modifyNotNullScriptDtos = getModifyNonNullColumnsScriptDtos(ddlProvider)(
			collection,
			collectionSchema,
			schemaName,
			options.dbVersion,
		);
		const modifiedDefaultValues = getDefaultValueChangeDto(collection, fullName);
		const changedComputedScriptsDtos = getChangedComputedColumnsScriptsDto({
			collection,
			fullName,
			collectionSchema,
			schemaName,
			dbVersion: options.dbVersion,
		});

		return [
			...renameColumnScriptsDtos,
			...changeTypeScriptsDtos,
			...modifyNotNullScriptDtos,
			...modifiedDefaultValues,
			...changedComputedScriptsDtos,
		].filter(Boolean);
	};

	const hydrateIndex =
		({ idToNameHashTable, idToActivatedHashTable, ddlProvider, tableData, schemaData }) =>
		index => {
			index = setIndexKeys(idToNameHashTable, idToActivatedHashTable, index);

			return ddlProvider.hydrateIndex(index, tableData, schemaData);
		};

	const getTableUpdateCommentScript = ({ schemaName, tableName, comment }) =>
		ddlProvider.updateTableComment({ schemaName, tableName, comment });
	const getTableDropCommentScript = ({ schemaName, tableName }) =>
		ddlProvider.dropTableComment({
			schemaName,
			tableName,
		});

	const getTablesDropCommentAlterScriptsDto = tables => {
		return Object.keys(tables)
			.map(tableName => {
				const table = tables[tableName];

				if (!table?.compMod?.deleted || !table?.role?.description) {
					return undefined;
				}

				const schemaName = table.role?.compMod.keyspaceName;
				const script = getTableDropCommentScript({ schemaName, tableName });

				return AlterScriptDto.getInstance([script], true, true);
			})
			.filter(Boolean);
	};

	const getTablesModifyCommentsAlterScriptsDto = tables => {
		return Object.keys(tables)
			.map(tableName => {
				let script = '';

				const tableComparison = tables[tableName].role?.compMod;
				const schemaName = tableComparison.keyspaceName;

				const newComment = tableComparison?.description?.new;
				const oldComment = tableComparison?.description?.old;

				const isCommentRemoved = oldComment && !newComment;

				if (isCommentRemoved) {
					script = getTableDropCommentScript({ schemaName, tableName });

					return AlterScriptDto.getInstance([script], true, true);
				}

				if (!newComment || newComment === oldComment) {
					return undefined;
				}

				if (oldComment) {
					script = getTableUpdateCommentScript({ schemaName, tableName, comment: newComment });
				} else {
					script = ddlProvider.createTableComment({
						schemaName,
						tableName,
						comment: newComment,
					});
				}

				return AlterScriptDto.getInstance([script], true, false);
			})
			.filter(Boolean);
	};

	const getColumnCreateCommentScript = ({ schemaName, tableName, columnName, comment }) =>
		ddlProvider.createColumnComment({
			schemaName,
			tableName,
			columnName,
			comment,
		});
	const getColumnUpdateCommentScript = ({ schemaName, tableName, columnName, comment }) =>
		ddlProvider.updateColumnComment({
			schemaName,
			tableName,
			columnName,
			comment,
		});
	const getColumnDropCommentScript = ({ schemaName, tableName, columnName }) =>
		ddlProvider.dropColumnComment({ schemaName, tableName, columnName });

	const getColumnsCreateCommentAlterScriptsDto = tables => {
		return Object.keys(tables)
			.flatMap(tableName => {
				const columns = tables[tableName].properties;
				if (!columns) {
					return [];
				}
				const schemaName = tables[tableName].role?.compMod.keyspaceName;
				return Object.keys(columns).map(columnName => {
					const column = columns[columnName];
					const isColumnRenamed = column?.compMod?.oldField?.name !== column?.compMod?.newField?.name;
					const columnNameToSearchComment = isColumnRenamed ? column?.compMod?.oldField?.name : columnName;
					const comment = column.description;
					const oldComment = tables[tableName].role?.properties[columnNameToSearchComment]?.description;

					if (!comment || oldComment) {
						return undefined;
					}

					const script = getColumnCreateCommentScript({ schemaName, tableName, columnName, comment });

					return AlterScriptDto.getInstance([script], true, false);
				});
			})
			.filter(Boolean);
	};

	const getColumnsDropCommentAlterScriptsDto = tables => {
		return Object.keys(tables)
			.flatMap(tableName => {
				const columns = tables[tableName].properties;

				if (!columns) {
					return [];
				}

				const schemaName = tables[tableName].role?.compMod.keyspaceName;

				return Object.keys(columns)
					.filter(columnName => Boolean(columns[columnName].description))
					.map(columnName => {
						const script = getColumnDropCommentScript({ schemaName, tableName, columnName });

						return AlterScriptDto.getInstance([script], true, true);
					});
			})
			.filter(Boolean);
	};

	const getColumnsModifyCommentAlterScriptsDto = tables => {
		return Object.keys(tables)
			.flatMap(tableName => {
				const columns = tables[tableName].properties;
				if (!columns) {
					return undefined;
				}
				const schemaName = tables[tableName].role?.compMod.keyspaceName;
				return Object.keys(columns).map(columnName => {
					let script = '';
					const newComment = columns[columnName]?.description;
					const oldComment = tables[tableName].role?.properties[columnName]?.description;
					const isCommentRemoved = oldComment && !newComment;

					if (isCommentRemoved) {
						script = getColumnDropCommentScript({ schemaName, tableName, columnName });

						return AlterScriptDto.getInstance([script], true, true);
					}

					if (!newComment || !oldComment || newComment === oldComment) {
						return undefined;
					}

					if (oldComment) {
						script = getColumnUpdateCommentScript({
							schemaName,
							tableName,
							columnName,
							comment: newComment,
						});
					} else {
						script = getColumnCreateCommentScript({
							schemaName,
							tableName,
							columnName,
							comment: newComment,
						});
					}

					return AlterScriptDto.getInstance([script], true, false);
				});
			})
			.filter(Boolean);
	};

	return {
		getAddCollectionScriptDto,
		getDeleteCollectionScriptDto,
		getModifyCollectionScriptDto,
		getAddColumnScriptDto,
		getDeleteColumnScriptDto,
		getModifyColumnScriptDto,
		getTablesDropCommentAlterScriptsDto,
		getTablesModifyCommentsAlterScriptsDto,
		getColumnsCreateCommentAlterScriptsDto,
		getColumnsDropCommentAlterScriptsDto,
		getColumnsModifyCommentAlterScriptsDto,
	};
};

module.exports = alterEntityHelper;
