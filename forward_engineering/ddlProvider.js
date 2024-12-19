const defaultTypes = require('./configs/defaultTypes');
const types = require('./configs/types');
const templates = require('./configs/templates');
const { commentIfDeactivated } = require('./helpers/commentIfDeactivated');
const { joinActivatedAndDeactivatedStatements } = require('./utils/joinActivatedAndDeactivatedStatements');

module.exports = (baseProvider, options, app) => {
	const _ = app.require('lodash');
	const { assignTemplates } = app.require('@hackolade/ddl-fe-utils');
	const { checkAllKeysDeactivated, divideIntoActivatedAndDeactivated, getEntityName } =
		app.require('@hackolade/ddl-fe-utils').general;
	const { wrapInBrackets } = require('./utils/general')(_);

	const { decorateType, getIdentity, getEncryptedWith, getColumnsComments, canHaveIdentity } =
		require('./helpers/columnDefinitionHelper')(app);
	const {
		createIndex,
		hydrateIndex,
		getMemoryOptimizedIndexes,
		createMemoryOptimizedIndex,
		hydrateTableIndex,
		createTableIndex,
	} = require('./helpers/indexHelper')(app);
	const {
		getTableName,
		getTableOptions,
		hasType,
		getDefaultConstraints,
		foreignKeysToString,
		checkIndexActivated,
		getDefaultValue,
		getTempTableTime,
		foreignActiveKeysToString,
		additionalPropertiesForForeignKey,
	} = require('./helpers/general')(app);
	const keyHelper = require('./helpers/keyHelper')(app);
	const { getTerminator } = require('./helpers/optionsHelper');
	const { createKeyConstraint, createDefaultConstraint, generateConstraintsString } =
		require('./helpers/constraintsHelper')(app);
	const { wrapIfNotExistSchema, wrapIfNotExistDatabase, wrapIfNotExistTable, wrapIfNotExistView } =
		require('./helpers/ifNotExistStatementHelper')(app);
	const { getPartitionedTables, getCreateViewData } = require('./helpers/viewHelper')(app);
	const { getFullTableName, escapeSpecialCharacters } = require('./utils/general')(_);

	const terminator = getTerminator(options);

	return {
		createSchema({ schemaName, databaseName, ifNotExist, comment, isActivated }) {
			const schemaTerminator = ifNotExist ? ';' : terminator;

			const schemaComment = comment
				? this.createSchemaComment({
						schemaName,
						comment,
						customTerminator: schemaTerminator,
					})
				: '';

			let schemaStatement = commentIfDeactivated(
				assignTemplates(templates.createSchema, {
					name: schemaName,
					terminator: schemaTerminator,
					comment: schemaComment ? `\n\n${schemaComment}` : '',
				}),
				{ isActivated },
			);

			if (!databaseName) {
				return ifNotExist
					? wrapIfNotExistSchema({ templates, schemaStatement, schemaName, terminator })
					: schemaStatement;
			}

			const databaseStatement = wrapIfNotExistDatabase({
				templates,
				databaseName,
				terminator,
				databaseStatement: assignTemplates(templates.createDatabase, {
					name: databaseName,
					terminator: schemaTerminator,
				}),
			});

			const useStatement = assignTemplates(templates.useDatabase, {
				name: databaseName,
				terminator: schemaTerminator,
			});

			if (ifNotExist) {
				return (
					databaseStatement +
					'\n\n' +
					useStatement +
					'\n\n' +
					wrapIfNotExistSchema({ templates, schemaStatement, schemaName, terminator })
				);
			}

			return databaseStatement + '\n\n' + useStatement + '\n\n' + schemaStatement;
		},

		createTable(
			{
				name,
				columns,
				checkConstraints,
				foreignKeyConstraints,
				keyConstraints,
				options,
				schemaData,
				defaultConstraints,
				memoryOptimizedIndexes,
				temporalTableTime,
				ifNotExist,
				comment,
				columnDefinitions,
			},
			isActivated,
		) {
			const tableTerminator = ifNotExist ? ';' : terminator;
			const tableName = getTableName(name, schemaData.schemaName);
			const tableComment =
				comment && !options.memory_optimized
					? this.createTableComment({
							schemaName: schemaData.schemaName,
							tableName: name,
							customTerminator: tableTerminator,
							comment,
						})
					: '';
			const columnComments = getColumnsComments(name, tableTerminator, columnDefinitions);
			const dividedKeysConstraints = divideIntoActivatedAndDeactivated(
				keyConstraints.map(createKeyConstraint(templates, tableTerminator, isActivated)),
				key => key.statement,
			);
			const keyConstraintsString = generateConstraintsString(dividedKeysConstraints, isActivated);
			const temporalTableTimeStatement =
				temporalTableTime.startTime && temporalTableTime.endTime
					? `,\n\tPERIOD FOR SYSTEM_TIME(${temporalTableTime.startTime}, ${temporalTableTime.endTime})`
					: '';
			const dividedForeignKeys = divideIntoActivatedAndDeactivated(foreignKeyConstraints, key => key.statement);
			const foreignKeyConstraintsString = generateConstraintsString(dividedForeignKeys, isActivated);
			const tableAndColumnCommentsSeparator = tableComment ? '\n\n' : '';
			const columnStatements = joinActivatedAndDeactivatedStatements({ statements: columns, indent: '\n\t' });
			const tableStatement = assignTemplates(templates.createTable, {
				name: tableName,
				column_definitions: columnStatements,
				temporalTableTime: temporalTableTimeStatement,
				checkConstraints: checkConstraints.length ? ',\n\t' + checkConstraints.join(',\n\t') : '',
				foreignKeyConstraints: foreignKeyConstraintsString,
				options: getTableOptions(options),
				keyConstraints: keyConstraintsString,
				memoryOptimizedIndexes: memoryOptimizedIndexes.length
					? ',\n\t' +
						memoryOptimizedIndexes
							.map(createMemoryOptimizedIndex(isActivated))
							.map(index => commentIfDeactivated(index.statement, index))
							.join(',\n\t')
					: '',
				terminator: tableTerminator,
				comment: tableComment ? `\n${tableComment}` : '',
				columnComments: columnComments ? `${tableAndColumnCommentsSeparator}${columnComments}\n` : '',
			});
			const defaultConstraintsStatements = defaultConstraints
				.map(data => createDefaultConstraint(templates, tableTerminator)(data, tableName))
				.join('\n');

			const fullTableStatement = [tableStatement, defaultConstraintsStatements].filter(Boolean).join('\n\n');

			return ifNotExist
				? wrapIfNotExistTable({
						tableStatement: fullTableStatement,
						templates,
						tableName: getTableName(name, schemaData.schemaName, false),
						terminator,
					})
				: fullTableStatement;
		},

		convertColumnDefinition(columnDefinition) {
			const type = hasType(columnDefinition.type)
				? _.toUpper(columnDefinition.type)
				: getTableName(columnDefinition.type, columnDefinition.schemaName);
			const notNull = columnDefinition.nullable ? '' : ' NOT NULL';
			const primaryKey = columnDefinition.primaryKey
				? ' ' + createKeyConstraint(templates, terminator, true)(columnDefinition.primaryKeyOptions).statement
				: '';
			const defaultValue = getDefaultValue(
				columnDefinition.default,
				columnDefinition.defaultConstraint?.name,
				type,
			);
			const sparse = columnDefinition.sparse ? ' SPARSE' : '';
			const maskedWithFunction = columnDefinition.maskedWithFunction
				? ` MASKED WITH (FUNCTION='${columnDefinition.maskedWithFunction}')`
				: '';
			const identityContainer = columnDefinition.identity && { identity: getIdentity(columnDefinition.identity) };
			const encryptedWith = !_.isEmpty(columnDefinition.encryption)
				? getEncryptedWith(columnDefinition.encryption[0])
				: '';
			const unique = columnDefinition.unique
				? ' ' + createKeyConstraint(templates, terminator, true)(columnDefinition.uniqueKeyOptions).statement
				: '';
			const temporalTableTime = getTempTableTime(
				columnDefinition.isTempTableStartTimeColumn,
				columnDefinition.isTempTableEndTimeColumn,
				columnDefinition.isHidden,
			);

			const statement = assignTemplates(templates.columnDefinition, {
				name: columnDefinition.name,
				type: decorateType(type, columnDefinition),
				primary_key: primaryKey + unique,
				not_null: notNull,
				default: defaultValue,
				sparse,
				maskedWithFunction,
				encryptedWith,
				terminator,
				temporalTableTime,
				...identityContainer,
			});

			return commentIfDeactivated(statement, { isActivated: columnDefinition.isActivated });
		},

		createIndex(tableName, index, dbData, isParentActivated = true) {
			const isActivated = checkIndexActivated(index);
			if (!isParentActivated) {
				return createTableIndex(terminator, tableName, index, isActivated && isParentActivated);
			}
			return createTableIndex(terminator, tableName, index, isActivated && isParentActivated);
		},

		createCheckConstraint(checkConstraint) {
			return assignTemplates(templates.checkConstraint, {
				name: checkConstraint.name,
				notForReplication: checkConstraint.enforceForReplication ? '' : ' NOT FOR REPLICATION',
				expression: _.trim(checkConstraint.expression).replace(/^\(([\s\S]*)\)$/, '$1'),
				terminator,
			});
		},

		createForeignKeyConstraint(
			{
				name,
				foreignKey,
				primaryTable,
				primaryKey,
				primaryTableActivated,
				foreignTableActivated,
				primarySchemaName,
				customProperties,
			},
			dbData,
			schemaData,
		) {
			const isAllPrimaryKeysDeactivated = checkAllKeysDeactivated(primaryKey);
			const isAllForeignKeysDeactivated = checkAllKeysDeactivated(foreignKey);
			const isActivated =
				!isAllPrimaryKeysDeactivated &&
				!isAllForeignKeysDeactivated &&
				primaryTableActivated &&
				foreignTableActivated;

			const { foreignOnDelete, foreignOnUpdate } = additionalPropertiesForForeignKey(customProperties);

			return {
				statement: assignTemplates(templates.createForeignKeyConstraint, {
					primaryTable: getTableName(primaryTable, primarySchemaName || schemaData.schemaName, true),
					name: wrapInBrackets(name),
					foreignKey: isActivated ? foreignKeysToString(foreignKey) : foreignActiveKeysToString(foreignKey),
					primaryKey: isActivated ? foreignKeysToString(primaryKey) : foreignActiveKeysToString(primaryKey),
					onDelete: foreignOnDelete ? ` ON DELETE ${foreignOnDelete}` : '',
					onUpdate: foreignOnUpdate ? ` ON UPDATE ${foreignOnUpdate}` : '',
					terminator,
				}),
				isActivated,
			};
		},

		createForeignKey(
			{
				name,
				foreignTable,
				foreignKey,
				primaryTable,
				primaryKey,
				primaryTableActivated,
				foreignTableActivated,
				customProperties,
			},
			dbData,
			schemaData,
		) {
			const isAllPrimaryKeysDeactivated = checkAllKeysDeactivated(primaryKey);
			const isAllForeignKeysDeactivated = checkAllKeysDeactivated(foreignKey);

			const { foreignOnDelete, foreignOnUpdate } = additionalPropertiesForForeignKey(customProperties);

			return {
				statement: assignTemplates(templates.createForeignKey, {
					primaryTable: getTableName(primaryTable, schemaData.schemaName, true),
					foreignTable: getTableName(foreignTable, schemaData.schemaName, true),
					name: wrapInBrackets(name),
					foreignKey: foreignKeysToString(foreignKey),
					primaryKey: foreignKeysToString(primaryKey),
					onDelete: foreignOnDelete ? ` ON DELETE ${foreignOnDelete}` : '',
					onUpdate: foreignOnUpdate ? ` ON UPDATE ${foreignOnUpdate}` : '',
					terminator,
				}),
				isActivated:
					!isAllPrimaryKeysDeactivated &&
					!isAllForeignKeysDeactivated &&
					primaryTableActivated &&
					foreignTableActivated,
			};
		},

		createView(
			{
				name,
				keys,
				partitionedTables,
				partitioned,
				viewAttrbute,
				withCheckOption,
				selectStatement,
				schemaData,
				ifNotExist,
				comment,
			},
			dbData,
			isActivated,
		) {
			const viewData = getCreateViewData({
				name,
				keys,
				partitionedTables,
				partitioned,
				viewAttrbute,
				withCheckOption,
				selectStatement,
				schemaData,
				ifNotExist,
				terminator,
				isActivated,
			});

			if (!viewData) {
				return '';
			}

			const viewComment = comment
				? this.createViewComment({
						schemaName: schemaData.schemaName,
						viewName: name,
						comment,
						customTerminator: viewData.terminator,
					})
				: '';

			const viewStatement = assignTemplates(templates.createView, {
				name: viewData.viewName,
				view_attribute: viewData.viewAttribute,
				check_option: viewData.checkOption,
				select_statement: viewData.selectStatement,
				terminator: viewData.terminator,
				comment: viewComment ? `\n${viewComment}` : '',
			});

			return ifNotExist
				? wrapIfNotExistView({ templates, viewStatement, viewName: viewData.viewNameIfNotExist, terminator })
				: viewStatement;
		},

		createViewIndex(viewName, index, dbData, isParentActivated = true) {
			const isActivated = checkIndexActivated(index);
			return commentIfDeactivated(createIndex(terminator, viewName, index, isActivated && isParentActivated), {
				isActivated: isParentActivated ? isActivated : true,
			});
		},

		createUdt(udt) {
			const notNull = udt.nullable ? '' : ' NOT NULL';
			const type = decorateType(hasType(udt.type) ? _.toUpper(udt.type) : udt.type, udt);

			return assignTemplates(templates.createUdtFromBaseType, {
				name: getTableName(udt.name, udt.schemaName),
				base_type: type,
				not_null: notNull,
				terminator,
			});
		},

		getDefaultType(type) {
			return defaultTypes[type];
		},

		getTypesDescriptors() {
			return types;
		},

		hasType(type) {
			return hasType(type);
		},

		hydrateColumn({ columnDefinition, jsonSchema, schemaData, parentJsonSchema }) {
			let encryption = [];

			if (Array.isArray(jsonSchema.encryption)) {
				encryption = jsonSchema.encryption.map(
					({ COLUMN_ENCRYPTION_KEY: key, ENCRYPTION_TYPE: type, ENCRYPTION_ALGORITHM: algorithm }) => ({
						key,
						type,
						algorithm,
					}),
				);
			} else if (_.isPlainObject(jsonSchema.encryption)) {
				encryption = [
					{
						key: jsonSchema.encryption.COLUMN_ENCRYPTION_KEY,
						type: jsonSchema.encryption.ENCRYPTION_TYPE,
						algorithm: jsonSchema.encryption.ENCRYPTION_ALGORITHM,
					},
				];
			}

			const isTempTableStartTimeColumn =
				jsonSchema.GUID === _.get(parentJsonSchema, 'periodForSystemTime[0].startTime[0].keyId', '');
			const isTempTableEndTimeColumn =
				jsonSchema.GUID === _.get(parentJsonSchema, 'periodForSystemTime[0].endTime[0].keyId', '');
			const isTempTableStartTimeColumnHidden =
				_.get(parentJsonSchema, 'periodForSystemTime[0].startTime[0].type', '') === 'hidden';
			const isTempTableEndTimeColumnHidden =
				_.get(parentJsonSchema, 'periodForSystemTime[0].startTime[0].type', '') === 'hidden';

			return Object.assign({}, columnDefinition, {
				default: jsonSchema.defaultConstraintName ? '' : columnDefinition.default,
				defaultConstraint: {
					name: jsonSchema.defaultConstraintName,
					value: columnDefinition.default,
				},
				primaryKey: keyHelper.isInlinePrimaryKey(jsonSchema),
				primaryKeyOptions: _.omit(
					keyHelper.hydratePrimaryKeyOptions(jsonSchema.primaryKeyOptions || {}),
					'columns',
				),
				xmlConstraint: String(jsonSchema.XMLconstraint || ''),
				xmlSchemaCollection: String(jsonSchema.xml_schema_collection || ''),
				sparse: Boolean(jsonSchema.sparse),
				maskedWithFunction: String(jsonSchema.maskedWithFunction || ''),
				schemaName: schemaData.schemaName,
				unique: keyHelper.isInlineUnique(jsonSchema),
				uniqueKeyOptions: _.omit(
					keyHelper.hydrateUniqueOptions(_.first(jsonSchema.uniqueKeyOptions) || {}),
					'columns',
				),
				isTempTableStartTimeColumn,
				isTempTableEndTimeColumn,
				isHidden: isTempTableStartTimeColumn
					? isTempTableStartTimeColumnHidden
					: isTempTableEndTimeColumnHidden,
				encryption,
				hasMaxLength: columnDefinition.hasMaxLength || jsonSchema.type === 'jsonObject',
				comment: jsonSchema.description,
				...(canHaveIdentity(jsonSchema.mode) && {
					identity: {
						seed: Number(_.get(jsonSchema, 'identity.identitySeed', 0)),
						increment: Number(_.get(jsonSchema, 'identity.identityIncrement', 0)),
					},
				}),
			});
		},

		hydrateIndex(indexData, tableData, schemaData) {
			const isMemoryOptimized = _.get(tableData, '[0].memory_optimized', false);

			if (isMemoryOptimized) {
				return;
			}

			return hydrateTableIndex(indexData, schemaData);
		},

		hydrateViewIndex(indexData, schemaData) {
			return hydrateIndex(indexData, schemaData);
		},

		hydrateCheckConstraint(checkConstraint) {
			return {
				name: checkConstraint.chkConstrName,
				expression: checkConstraint.constrExpression,
				existingData: checkConstraint.constrCheck,
				enforceForUpserts: checkConstraint.constrEnforceUpserts,
				enforceForReplication: checkConstraint.constrEnforceReplication,
			};
		},

		hydrateSchema(containerData) {
			return {
				schemaName: containerData.name,
				databaseName: containerData.databaseName,
				ifNotExist: containerData.ifNotExist,
				comment: containerData.role?.description ?? containerData.description,
				isActivated: containerData.isActivated,
			};
		},

		hydrateTable({ tableData, entityData, jsonSchema, idToNameHashTable }) {
			const isMemoryOptimized = _.get(entityData, '[0].memory_optimized', false);
			const temporalTableTimeStartColumnName =
				idToNameHashTable[_.get(jsonSchema, 'periodForSystemTime[0].startTime[0].keyId', '')];
			const temporalTableTimeEndColumnName =
				idToNameHashTable[_.get(jsonSchema, 'periodForSystemTime[0].endTime[0].keyId', '')];
			return Object.assign({}, tableData, {
				foreignKeyConstraints: tableData.foreignKeyConstraints || [],
				keyConstraints: keyHelper.getTableKeyConstraints({ jsonSchema }),
				defaultConstraints: getDefaultConstraints(tableData.columnDefinitions),
				ifNotExist: jsonSchema.ifNotExist,
				comment: jsonSchema.description,
				columnDefinitions: tableData.columnDefinitions,
				options: {
					memory_optimized: isMemoryOptimized,
					durability: _.get(entityData, '[0].durability', ''),
					systemVersioning: _.get(entityData, '[0].systemVersioning', false),
					historyTable: _.get(entityData, '[0].historyTable', ''),
					dataConsistencyCheck: _.get(entityData, '[0].dataConsistencyCheck', false),
					temporal: _.get(entityData, '[0].temporal', false),
					ledger: _.get(entityData, '[0].ledger', false),
					ledger_view: _.get(entityData, '[0].ledger_view'),
					transaction_id_column_name: _.get(entityData, '[0].transaction_id_column_name'),
					sequence_number_column_name: _.get(entityData, '[0].sequence_number_column_name'),
					operation_type_id_column_name: _.get(entityData, '[0].operation_type_id_column_name'),
					operation_type_desc_column_name: _.get(entityData, '[0].operation_type_desc_column_name'),
					append_only: _.get(entityData, '[0].append_only', false),
					temporalTableTimeStartColumnName,
					temporalTableTimeEndColumnName,
				},
				temporalTableTime: {
					startTime: temporalTableTimeStartColumnName,
					endTime: temporalTableTimeEndColumnName,
				},
				memoryOptimizedIndexes: isMemoryOptimized
					? getMemoryOptimizedIndexes(entityData, tableData.schemaData)
					: [],
			});
		},

		hydrateViewColumn(data) {
			return {
				dbName: _.get(data.containerData, '[0].databaseName', ''),
				schemaName: data.dbName,
				alias: data.alias,
				name: data.name,
				tableName: data.entityName,
				isActivated: data.isActivated,
			};
		},

		hydrateView({ viewData, entityData, relatedSchemas, relatedContainers }) {
			const firstTab = _.get(entityData, '[0]', {});
			const isPartitioned = _.get(entityData, '[0].partitioned');
			const ifNotExist = _.get(entityData, '[0].ifNotExist');
			const comment = _.get(entityData, '[0].description');
			return {
				...viewData,
				selectStatement: firstTab.selectStatement || '',
				viewAttrbute: firstTab.viewAttrbute || '',
				materialized: firstTab.materialized,
				withCheckOption: Boolean(firstTab.withCheckOption),
				partitioned: isPartitioned,
				ifNotExist,
				comment,
				partitionedTables: isPartitioned
					? getPartitionedTables(
							_.get(entityData, '[0].partitionedTables', []),
							relatedSchemas,
							relatedContainers,
						)
					: [],
			};
		},

		commentIfDeactivated(statement, data, isPartOfLine) {
			return commentIfDeactivated(statement, data, isPartOfLine);
		},

		// * DROP statements for alter script from delta model
		dropSchema(name) {
			return assignTemplates(templates.dropSchema, {
				terminator,
				name,
			});
		},

		dropTable(fullTableName) {
			return assignTemplates(templates.dropTable, {
				name: fullTableName,
				terminator,
			});
		},

		dropIndex(tableName, index) {
			const object = getTableName(tableName, index.schemaName);

			return assignTemplates(templates.dropIndex, {
				name: index.name,
				object,
				terminator,
			});
		},

		dropConstraint(fullTableName, constraintName) {
			return assignTemplates(templates.dropConstraint, {
				tableName: fullTableName,
				constraintName,
				terminator,
			});
		},

		alterTableOptions(jsonSchema, schemaData, idToNameHashTable) {
			const tableName = getTableName(getEntityName(jsonSchema), schemaData.schemaName);

			const compMod = jsonSchema.role?.compMod ?? {};
			const isSystemVersioning = compMod.systemVersioning?.old !== compMod.systemVersioning?.new;
			const isHistoryTable = compMod.historyTable?.old !== compMod.historyTable?.new;
			const isDataConsistencyCheck = compMod.dataConsistencyCheck?.old !== compMod.dataConsistencyCheck?.new;
			const isPeriodForSystemTime = !_.isEqual(
				compMod.periodForSystemTime?.old,
				compMod.periodForSystemTime?.new,
			);

			const isChangedProperties =
				isSystemVersioning || isHistoryTable || isDataConsistencyCheck || isPeriodForSystemTime;

			const temporalTableTimeStartColumnName =
				idToNameHashTable[_.get(jsonSchema, 'periodForSystemTime[0].startTime[0].keyId', '')];
			const temporalTableTimeEndColumnName =
				idToNameHashTable[_.get(jsonSchema, 'periodForSystemTime[0].endTime[0].keyId', '')];

			const options = {
				memory_optimized: jsonSchema.memory_optimized,
				durability: jsonSchema.durability ?? '',
				systemVersioning: jsonSchema.systemVersioning ?? false,
				historyTable: jsonSchema.historyTable ?? '',
				dataConsistencyCheck: jsonSchema.dataConsistencyCheck ?? false,
				temporal: jsonSchema.temporal ?? false,
				ledger: jsonSchema.ledger ?? false,
				ledger_view: jsonSchema.ledger_view,
				transaction_id_column_name: jsonSchema.transaction_id_column_name,
				sequence_number_column_name: jsonSchema.sequence_number_column_name,
				operation_type_id_column_name: jsonSchema.operation_type_id_column_name,
				operation_type_desc_column_name: jsonSchema.operation_type_desc_column_name,
				append_only: jsonSchema.append_only ?? false,
				temporalTableTimeStartColumnName,
				temporalTableTimeEndColumnName,
			};

			if (!isChangedProperties) {
				return '';
			}

			const optionsScript = _.trim(getTableOptions(options)?.replace('WITH', 'SET'));

			return assignTemplates(templates.dropIndex, {
				options: optionsScript,
				tableName,
				terminator,
			});
		},

		alterTableAddCheckConstraint(fullTableName, checkConstraint) {
			return assignTemplates(templates.alterTableAddConstraint, {
				tableName: fullTableName,
				constraint: this.createCheckConstraint(checkConstraint),
				terminator,
			});
		},

		dropColumn(fullTableName, columnName) {
			const command = assignTemplates(templates.dropColumn, {
				name: columnName,
			});

			return assignTemplates(templates.alterTable, {
				tableName: fullTableName,
				command,
				terminator,
			});
		},

		addColumn(fullTableName, script) {
			const command = assignTemplates(templates.addColumn, {
				script,
			});

			return assignTemplates(templates.alterTable, {
				tableName: fullTableName,
				command,
				terminator,
			});
		},

		renameColumn(fullTableName, oldColumnName, newColumnName) {
			return assignTemplates(templates.renameColumn, {
				terminator: terminator === ';' ? '' : terminator,
				fullTableName: fullTableName,
				oldColumnName,
				newColumnName,
			});
		},

		alterColumn(fullTableName, columnDefinition) {
			const type = hasType(columnDefinition.type)
				? _.toUpper(columnDefinition.type)
				: getTableName(columnDefinition.type, columnDefinition.schemaName);
			const notNull = columnDefinition.nullable ? ' NULL' : ' NOT NULL';

			const command = assignTemplates(templates.alterColumn, {
				name: columnDefinition.name,
				type: decorateType(type, columnDefinition),
				not_null: notNull,
			});

			return assignTemplates(templates.alterTable, {
				tableName: fullTableName,
				command,
				terminator,
			});
		},

		dropView(fullViewName) {
			return assignTemplates(templates.dropView, {
				name: fullViewName,
				terminator,
			});
		},

		alterView(
			{ name, keys, partitionedTables, partitioned, viewAttrbute, withCheckOption, selectStatement, schemaData },
			dbData,
			isActivated,
		) {
			const viewData = getCreateViewData({
				name,
				keys,
				partitionedTables,
				partitioned,
				viewAttrbute,
				withCheckOption,
				selectStatement,
				schemaData,
				terminator,
				isActivated,
			});

			if (!viewData) {
				return '';
			}

			return assignTemplates(templates.alterView, {
				name: viewData.viewName,
				viewAttribute: viewData.viewAttribute,
				checkOption: viewData.checkOption,
				selectStatement: viewData.selectStatement,
				terminator,
			});
		},

		dropUdt(udt) {
			return assignTemplates(templates.dropType, {
				name: getTableName(udt.name, udt.schemaName),
				terminator,
			});
		},

		createSchemaComment({ schemaName, comment, customTerminator }) {
			return assignTemplates(templates.createSchemaComment, {
				value: escapeSpecialCharacters(comment),
				schemaName: wrapInBrackets(schemaName),
				terminator: customTerminator ?? terminator,
			});
		},

		createTableComment({ schemaName, tableName, comment, customTerminator }) {
			if (!schemaName) {
				return '';
			}

			return assignTemplates(templates.createTableComment, {
				value: escapeSpecialCharacters(comment),
				schemaName: wrapInBrackets(schemaName),
				tableName: wrapInBrackets(tableName),
				terminator: customTerminator ?? terminator,
			});
		},

		createColumnComment({ schemaName, tableName, columnName, comment, customTerminator }) {
			if (!tableName || !columnName) {
				return '';
			}

			return assignTemplates(templates.createColumnComment, {
				value: escapeSpecialCharacters(comment),
				schemaName: wrapInBrackets(schemaName),
				tableName: wrapInBrackets(tableName),
				columnName: wrapInBrackets(columnName),
				terminator: customTerminator ?? terminator,
			});
		},

		createViewComment({ schemaName, viewName, comment, customTerminator }) {
			if (!schemaName) {
				return '';
			}

			return assignTemplates(templates.createViewComment, {
				value: escapeSpecialCharacters(comment),
				schemaName: wrapInBrackets(schemaName),
				viewName: wrapInBrackets(viewName),
				terminator: customTerminator ?? terminator,
			});
		},

		dropSchemaComment({ schemaName, customTerminator }) {
			return assignTemplates(templates.dropSchemaComment, {
				schemaName: wrapInBrackets(schemaName),
				terminator: customTerminator ?? terminator,
			});
		},

		dropTableComment({ schemaName, tableName, customTerminator }) {
			if (!schemaName) {
				return '';
			}

			return assignTemplates(templates.dropTableComment, {
				schemaName: wrapInBrackets(schemaName),
				tableName: wrapInBrackets(tableName),
				terminator: customTerminator ?? terminator,
			});
		},

		dropColumnComment({ schemaName, tableName, columnName, customTerminator }) {
			if (!schemaName || !tableName) {
				return '';
			}

			return assignTemplates(templates.dropColumnComment, {
				schemaName: wrapInBrackets(schemaName),
				tableName: wrapInBrackets(tableName),
				columnName: wrapInBrackets(columnName),
				terminator: customTerminator ?? terminator,
			});
		},

		dropViewComment({ schemaName, viewName, customTerminator }) {
			if (!schemaName) {
				return '';
			}

			return assignTemplates(templates.dropViewComment, {
				schemaName: wrapInBrackets(schemaName),
				viewName: wrapInBrackets(viewName),
				terminator: customTerminator ?? terminator,
			});
		},

		updateSchemaComment({ schemaName, comment, customTerminator }) {
			return assignTemplates(templates.updateSchemaComment, {
				value: escapeSpecialCharacters(comment),
				schemaName: wrapInBrackets(schemaName),
				terminator: customTerminator ?? terminator,
			});
		},

		updateTableComment({ schemaName, tableName, comment, customTerminator }) {
			if (!schemaName) {
				return '';
			}

			return assignTemplates(templates.updateTableComment, {
				value: escapeSpecialCharacters(comment),
				schemaName: wrapInBrackets(schemaName),
				tableName: wrapInBrackets(tableName),
				terminator: customTerminator ?? terminator,
			});
		},

		updateColumnComment({ schemaName, tableName, columnName, comment, customTerminator }) {
			if (!schemaName || !tableName) {
				return '';
			}

			return assignTemplates(templates.updateColumnComment, {
				value: escapeSpecialCharacters(comment),
				schemaName: wrapInBrackets(schemaName),
				tableName: wrapInBrackets(tableName),
				columnName: wrapInBrackets(columnName),
				terminator: customTerminator ?? terminator,
			});
		},

		updateViewComment({ schemaName, viewName, comment, customTerminator }) {
			if (!schemaName) {
				return '';
			}

			return assignTemplates(templates.updateViewComment, {
				value: escapeSpecialCharacters(comment),
				schemaName: wrapInBrackets(schemaName),
				viewName: wrapInBrackets(viewName),
				terminator: customTerminator ?? terminator,
			});
		},

		addCheckConstraint(tableName, constraintName, expression) {
			const templateConfig = {
				tableName,
				constraintName,
				expression,
				terminator,
			};
			return assignTemplates(templates.addCheckConstraint, templateConfig);
		},

		setNotNullConstraint(tableName, columnName, columnDefinition) {
			const type = hasType(columnDefinition.type)
				? _.toUpper(columnDefinition.type)
				: getTableName(columnDefinition.type, columnDefinition.schemaName);

			return assignTemplates(templates.addNotNullConstraint, {
				tableName,
				columnName,
				columnType: decorateType(type, columnDefinition),
				terminator,
			});
		},

		dropNotNullConstraint(tableName, columnName, columnDefinition) {
			const type = hasType(columnDefinition.type)
				? _.toUpper(columnDefinition.type)
				: getTableName(columnDefinition.type, columnDefinition.schemaName);

			return assignTemplates(templates.dropNotNullConstraint, {
				tableName,
				columnName,
				columnType: decorateType(type, columnDefinition),
				terminator,
			});
		},

		addPKConstraint(tableName, isParentActivated, keyData, isPKWithOptions, isAlterScript) {
			const constraintStatementDto = createKeyConstraint(
				templates,
				terminator,
				isParentActivated,
				isPKWithOptions,
				isAlterScript,
			)(keyData);

			return {
				statement: assignTemplates(templates.addConstraint, {
					tableName,
					constraintStatement: (constraintStatementDto.statement || '').trim(),
					terminator,
				}),
				isActivated: constraintStatementDto.isActivated,
			};
		},

		dropPKConstraint(tableName, constraintName) {
			return assignTemplates(templates.dropConstraint, {
				tableName,
				constraintName,
				terminator,
			});
		},

		dropForeignKey(tableName, constraintName) {
			const templateConfig = {
				tableName,
				constraintName,
				terminator,
			};
			return assignTemplates(templates.dropConstraint, templateConfig);
		},
	};
};
