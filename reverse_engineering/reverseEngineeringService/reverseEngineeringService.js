const { groupBy, omit, partition } = require('lodash');
const {
	getTableInfo,
	getTableRow,
	getTableForeignKeys,
	getDatabaseIndexes,
	getTableColumnsDescription,
	getDatabaseMemoryOptimizedTables,
	getDatabaseCheckConstraints,
	getViewTableInfo,
	getTableKeyConstraints,
	getViewColumnRelations,
	getTableMaskedColumns,
	getDatabaseXmlSchemaCollection,
	getTableDefaultConstraintNames,
	getDatabaseUserDefinedTypes,
	getViewStatement,
	getViewsIndexes,
	getFullTextIndexes,
	getSpatialIndexes,
	getIndexesBucketCount,
	getVersionInfo,
	getDatabaseProcedures,
} = require('../databaseService/databaseService');
const {
	transformDatabaseTableInfoToJSON,
	reverseTableForeignKeys,
	reverseTableIndexes,
	defineRequiredFields,
	defineFieldsDescription,
	doesViewHaveRelatedTables,
	reverseTableCheckConstraints,
	changeViewPropertiesToReferences,
	defineFieldsKeyConstraints,
	defineMaskedColumns,
	defineJSONTypes,
	defineXmlFieldsCollections,
	defineFieldsDefaultConstraintNames,
	defineFieldsCompositeKeyConstraints,
	getUserDefinedTypes,
	reorderTableRows,
	containsJson,
	getPeriodForSystemTime,
} = require('./helpers');
const pipe = require('../helpers/pipe');
const { getUniqueIndexesColumns } = require('./helpers/getUniqueIndexesColumns');

const mergeCollectionsWithViews = ({ jsonSchemas }) => {
	const [viewSchemas, collectionSchemas] = partition(jsonSchemas, jsonSchema => jsonSchema.relatedTables);
	const groupedViewSchemas = groupBy(viewSchemas, 'dbName');
	const combinedViewSchemas = Object.entries(groupedViewSchemas).map(([dbName, views]) => {
		return {
			dbName,
			entityLevel: {},
			emptyBucket: false,
			bucketInfo: views[0].bucketInfo,
			views: views.map(view => omit(view, ['relatedTables'])),
		};
	});

	return [...collectionSchemas, ...combinedViewSchemas];
};

const getCollectionsRelationships = async ({ client, tablesInfo, logger }) => {
	const dbName = client.config.database;
	logger.log('info', { message: `Fetching tables relationships.` }, 'Reverse Engineering');
	logger.progress({ message: 'Fetching tables relationships', containerName: dbName, entityName: '' });
	const tableForeignKeys = await getTableForeignKeys({ client, dbName, tablesInfo, logger });

	return reverseTableForeignKeys(tableForeignKeys, dbName);
};

const getStandardDocumentByJsonSchema = ({ jsonSchema }) => {
	return Object.keys(jsonSchema.properties).reduce((result, key) => {
		return {
			...result,
			[key]: '',
		};
	}, {});
};

const isViewPartitioned = ({ viewStatement }) => {
	viewStatement = cleanComments({ definition: String(viewStatement).trim() });
	const viewContentRegexp = /CREATE[\s\S]+?VIEW[\s\S]+?AS\s+(?:WITH[\s\S]+AS\s+\([\s\S]+\))?([\s\S]+)/i;

	if (!viewContentRegexp.test(viewStatement)) {
		return false;
	}

	const content = viewStatement.match(viewContentRegexp)[1] || '';
	return content.toLowerCase().split(/union[\s\S]+?all/i).length > 1;
};

const getPartitionedJsonSchema = ({ viewInfo, viewColumnRelations }) => {
	const aliasToName = viewInfo.reduce(
		(aliasToName, item) => ({
			...aliasToName,
			[item.ColumnName]: item.ReferencedColumnName,
		}),
		{},
	);
	const tableName = viewInfo[0]['ReferencedTableName'];

	const properties = viewColumnRelations.reduce(
		(properties, column) => ({
			...properties,
			[column.name]: {
				$ref: `#collection/definitions/${tableName}/${aliasToName[column.name]}`,
				bucketName: column['source_schema'] || '',
			},
		}),
		{},
	);

	return {
		properties,
	};
};

const getPartitionedTables = ({ viewInfo }) => {
	const hasTable = (tables, item) =>
		tables.some(
			table => table.table[0] === item.ReferencedSchemaName && table.table[1] === item.ReferencedTableName,
		);

	return viewInfo.reduce((tables, item) => {
		if (!hasTable(tables, item)) {
			return tables.concat([
				{
					table: [item.ReferencedSchemaName, item.ReferencedTableName],
				},
			]);
		} else {
			return tables;
		}
	}, []);
};

const cleanComments = ({ definition }) =>
	definition
		.split('\n')
		.filter(line => !line.trim().startsWith('--'))
		.join('\n');

const getSelectStatementFromDefinition = ({ definition }) => {
	const regExp =
		/CREATE\s+VIEW[\s\S]+?(?:WITH\s+[\w,\s]+?\s+)?AS\s+((?:WITH|SELECT)[\s\S]+?)(WITH\s+CHECK\s+OPTION|$)/i;

	if (!regExp.test(definition.trim())) {
		return '';
	}

	return definition.trim().match(regExp)[1];
};

const getPartitionedSelectStatement = ({ definition, table, dbName }) => {
	const tableRef = new RegExp(`(\\[?${dbName}\\]?\\.)?(\\[?${table[0]}\\]?\\.)?\\[?${table[1]}\\]?`, 'i');
	const statement = getSelectStatementFromDefinition({ definition })
		.split(/UNION\s+ALL/i)
		.find(item => tableRef.test(item));

	if (!statement) {
		return '';
	}

	return statement.replace(tableRef, '${tableName}').trim();
};

const getViewProperties = ({ viewData }) => {
	if (!viewData) {
		return {};
	}

	const isSchemaBound = viewData.is_schema_bound;
	const withCheckOption = viewData.with_check_option;

	return {
		viewAttrbute: isSchemaBound ? 'SCHEMABINDING' : '',
		withCheckOption,
	};
};

const prepareViewJSON = async ({ client, dbName, viewName, schemaName, logger, jsonSchema }) => {
	const [viewInfo, viewColumnRelations, viewStatement] = await Promise.all([
		await getViewTableInfo({ client, dbName, viewName, schemaName, logger }),
		await getViewColumnRelations({ client, dbName, viewName, schemaName, logger }),
		await getViewStatement({ client, dbName, viewName, schemaName, logger }),
	]);

	if (isViewPartitioned({ viewStatement: viewStatement[0].definition })) {
		const partitionedSchema = getPartitionedJsonSchema({ viewInfo, viewColumnRelations });
		const partitionedTables = getPartitionedTables({ viewInfo });

		return {
			jsonSchema: JSON.stringify({
				...jsonSchema,
				properties: {
					...(jsonSchema.properties || {}),
					...partitionedSchema.properties,
				},
			}),
			data: {
				...getViewProperties({ viewData: viewStatement[0] }),
				selectStatement: getPartitionedSelectStatement({
					definition: cleanComments({ definition: String(viewStatement[0].definition) }),
					table: partitionedTables[0]?.table,
					dbName,
				}),
				partitioned: true,
				partitionedTables,
			},
			name: viewName,
			relatedTables: [
				{
					tableName: viewInfo[0]['ReferencedTableName'],
					schemaName: viewInfo[0]['ReferencedSchemaName'],
				},
			],
		};
	} else {
		return {
			jsonSchema: JSON.stringify(changeViewPropertiesToReferences({ jsonSchema, viewInfo, viewColumnRelations })),
			name: viewName,
			data: {
				...getViewProperties({ viewData: viewStatement[0] }),
				selectStatement: getSelectStatementFromDefinition({
					definition: cleanComments({ definition: String(viewStatement[0].definition) }),
				}),
			},
			relatedTables: viewInfo.map(columnInfo => ({
				tableName: columnInfo['ReferencedTableName'],
				schemaName: columnInfo['ReferencedSchemaName'],
			})),
		};
	}
};

const cleanNull = doc =>
	Object.entries(doc)
		.filter(([key, value]) => value !== null)
		.reduce(
			(result, [key, value]) => ({
				...result,
				[key]: value,
			}),
			{},
		);

const cleanDocuments = documents => {
	if (!Array.isArray(documents)) {
		return documents;
	}

	return documents.map(cleanNull);
};

const getMemoryOptimizedOptions = options => {
	if (!options) {
		return {};
	}
	const memory_optimized = options.is_memory_optimized;
	const systemVersioning = options.temporal_type_desc === 'SYSTEM_VERSIONED_TEMPORAL_TABLE';
	return {
		memory_optimized,
		systemVersioning,
		temporal: !memory_optimized && systemVersioning,
		durability: ['SCHEMA_ONLY', 'SCHEMA_AND_DATA'].includes(String(options.durability_desc).toUpperCase())
			? String(options.durability_desc).toUpperCase()
			: '',
		historyTable: options.history_table ? `${options.history_schema}.${options.history_table}` : '',
	};
};

const addTotalBucketCountToDatabaseIndexes = ({ databaseIndexes, indexesBucketCount }) => {
	const hash = indexesBucketCount.reduce((hash, i) => {
		return { ...hash, [i.index_id]: i.total_bucket_count };
	}, {});

	return databaseIndexes.map(i => {
		if (hash[i.index_id] === undefined) {
			return i;
		} else {
			return { ...i, total_bucket_count: hash[i.index_id] };
		}
	});
};

const logDiscoveredMetadataCount = ({ logger, label, items = [] }) => {
	logger.log('info', { message: `Found ${items.length} ${label}.` }, 'Reverse Engineering');
};

const fetchDatabaseMetadata = async ({ client, dbName, tablesInfo, logger, reverseEngineeringOptions }) => {
	const { includeProcedures = false } = reverseEngineeringOptions;
	const allUniqueSchemasAndTables = getAllUniqueSchemasAndTables({ tablesInfo });

	const rawDatabaseIndexes = await getDatabaseIndexes({ client, dbName, tablesInfo, logger });
	logDiscoveredMetadataCount({ logger, label: 'database indexes', items: rawDatabaseIndexes });

	const databaseCheckConstraints = await getDatabaseCheckConstraints({
		client,
		dbName,
		allUniqueSchemasAndTables,
		logger,
	});
	logDiscoveredMetadataCount({ logger, label: 'check constraints', items: databaseCheckConstraints });

	const viewsIndexes = await getViewsIndexes({ client, dbName, logger });
	logDiscoveredMetadataCount({ logger, label: 'view indexes', items: viewsIndexes });

	const fullTextIndexes = await getFullTextIndexes({
		client,
		dbName,
		allUniqueSchemasAndTables,
		logger,
	});
	logDiscoveredMetadataCount({ logger, label: 'full-text indexes', items: fullTextIndexes });

	const spatialIndexes = await getSpatialIndexes({
		client,
		dbName,
		allUniqueSchemasAndTables,
		logger,
	});
	logDiscoveredMetadataCount({ logger, label: 'spatial indexes', items: spatialIndexes });

	const procedures = await getDatabaseProcedures({ client, dbName, logger, includeProcedures });

	const indexesBucketCount = await getIndexesBucketCount({
		client,
		dbName,
		indexesId: rawDatabaseIndexes.map(i => i.index_id),
		logger,
	});
	const databaseUDT = await getDatabaseUserDefinedTypes({ client, dbName, logger });
	logDiscoveredMetadataCount({ logger, label: 'user-defined types', items: databaseUDT });

	const databaseMemoryOptimizedTables = await getDatabaseMemoryOptimizedTables({ client, dbName, logger });
	logDiscoveredMetadataCount({ logger, label: 'memory-optimized tables', items: databaseMemoryOptimizedTables });

	const xmlSchemaCollections = await getDatabaseXmlSchemaCollection({
		client,
		dbName,
		allUniqueSchemasAndTables,
		logger,
	});
	logDiscoveredMetadataCount({ logger, label: 'xml schema collection usages', items: xmlSchemaCollections });

	const uniqueDatabaseIndexesColumns = getUniqueIndexesColumns({ indexesColumns: rawDatabaseIndexes });
	const databaseIndexes = addTotalBucketCountToDatabaseIndexes({
		databaseIndexes: uniqueDatabaseIndexesColumns,
		indexesBucketCount,
	});

	return {
		databaseIndexes,
		databaseMemoryOptimizedTables,
		databaseCheckConstraints,
		xmlSchemaCollections,
		databaseUDT,
		viewsIndexes,
		fullTextIndexes,
		spatialIndexes,
		procedures,
	};
};

const processSchemas = async ({ tablesInfo, ...context }) => {
	const { logger, dbName } = context;

	logger.log('info', { message: `Fetching '${dbName}' database information` }, 'Reverse Engineering');
	logger.progress({ message: 'Fetching database information', containerName: dbName, entityName: '' });

	const schemaPromises = Object.entries(tablesInfo).map(([schemaName, tableNames]) =>
		processTables({ schemaName, tableNames, ...context }),
	);

	const allTables = await Promise.all(schemaPromises);
	return allTables.flat();
};

const processTables = async ({ schemaName, tableNames, ...context }) => {
	const tablePromises = tableNames.map(tableName =>
		processTable({ schemaName, rawTableName: tableName, ...context }),
	);
	const tables = await Promise.all(tablePromises);

	return tables.filter(Boolean);
};

const processTable = async ({ schemaName, rawTableName, ...context }) => {
	const { dbName, logger, reverseEngineeringOptions, client } = context;
	const { recordSamplingSettings, isFieldOrderAlphabetic } = reverseEngineeringOptions;
	const tableName = rawTableName.replace(/ \(v\)$/, '');

	logger.log(
		'info',
		{ message: `Fetching '${tableName}' table information from '${dbName}' database` },
		'Reverse Engineering',
	);
	logger.progress({
		message: 'Fetching table information',
		containerName: dbName,
		entityName: tableName,
	});

	const tableInfo = await getTableInfo({ client, dbName, tableName, tableSchema: schemaName, logger });
	const [tableRows, fieldsKeyConstraints] = await Promise.all([
		containsJson({ tableInfo })
			? getTableRow({
					client,
					dbName,
					tableName,
					tableSchema: schemaName,
					recordSamplingSettings,
					logger,
				})
			: Promise.resolve([]),
		getTableKeyConstraints({ client, dbName, tableName, schemaName, logger }),
	]);

	const isView = isViewTable({ tableInfo });
	const jsonSchema = await createJsonSchema({
		...context,
		tableInfo,
		tableRows,
		fieldsKeyConstraints,
		schemaName,
		tableName,
	});

	const reorderedTableRows = reorderTableRows({ tableRows, isFieldOrderAlphabetic });
	const standardDoc = getStandardDocument({ reorderedTableRows, jsonSchema, isFieldOrderAlphabetic });

	const periodForSystemTime = await getPeriodForSystemTime({
		client,
		dbName,
		tableName,
		schemaName,
		logger,
	});

	let result = createTableResult({
		...context,
		tableName,
		schemaName,
		jsonSchema,
		standardDoc,
		reorderedTableRows,
		periodForSystemTime,
		tableInfo,
		fieldsKeyConstraints,
	});

	if (isView) {
		result = await processView({ processedTableResult: result, tableName, schemaName, jsonSchema, ...context });
	}

	return result;
};

function isViewTable({ tableInfo }) {
	const tableType = tableInfo[0]?.['TABLE_TYPE'];
	return tableType && tableType.trim() === 'V';
}

const createJsonSchema = async ({
	tableInfo,
	tableRows,
	fieldsKeyConstraints,
	schemaName,
	tableName,
	xmlSchemaCollections,
	client,
	dbName,
	logger,
}) => {
	const commonContext = { client, dbName, tableName, schemaName, logger };
	return pipe(
		transformDatabaseTableInfoToJSON(tableInfo),
		defineRequiredFields,
		defineFieldsDescription(await getTableColumnsDescription(commonContext)),
		defineFieldsKeyConstraints(fieldsKeyConstraints),
		defineMaskedColumns(await getTableMaskedColumns(commonContext)),
		defineJSONTypes(tableRows),
		defineXmlFieldsCollections(
			xmlSchemaCollections.filter(
				collection => collection.tableName === tableName && collection.schemaName === schemaName,
			),
		),
		defineFieldsDefaultConstraintNames(await getTableDefaultConstraintNames(commonContext)),
	)({ required: [], properties: {} });
};

const getStandardDocument = ({ reorderedTableRows, jsonSchema, isFieldOrderAlphabetic }) =>
	Array.isArray(reorderedTableRows) && reorderedTableRows.length
		? reorderedTableRows
		: reorderTableRows({ tableRows: [getStandardDocumentByJsonSchema({ jsonSchema })], isFieldOrderAlphabetic });

const getAllUniqueSchemasAndTables = ({ tablesInfo }) =>
	Object.keys(tablesInfo).reduce(
		(acc, schemaName) => {
			acc.schemas.add(`'${schemaName}'`);
			tablesInfo[schemaName].forEach(tableName => acc.tables.add(`'${tableName}'`));
			return acc;
		},
		{ schemas: new Set(), tables: new Set() },
	);

const createTableResult = ({
	dbName,
	databaseUDT,
	tableName,
	schemaName,
	jsonSchema,
	standardDoc,
	reorderedTableRows,
	periodForSystemTime,
	tableInfo,
	fieldsKeyConstraints,
	databaseIndexes,
	fullTextIndexes,
	spatialIndexes,
	databaseCheckConstraints,
	databaseMemoryOptimizedTables,
	procedures,
}) => {
	const tableIndexes = [...databaseIndexes, ...fullTextIndexes, ...spatialIndexes].filter(
		index => index.TableName === tableName && index.schemaName === schemaName,
	);

	const tableCheckConstraints = databaseCheckConstraints.filter(cc => cc.table === tableName);

	const schemaProcedures = procedures.filter(procedure => procedure.schemaName === schemaName);

	return {
		collectionName: tableName,
		dbName: schemaName,
		entityLevel: {
			Indxs: reverseTableIndexes({ tableIndexes }),
			chkConstr: reverseTableCheckConstraints(tableCheckConstraints),
			periodForSystemTime,
			...getMemoryOptimizedOptions(databaseMemoryOptimizedTables.find(item => item.name === tableName)),
			...defineFieldsCompositeKeyConstraints({ keyConstraintsInfo: fieldsKeyConstraints }),
		},
		standardDoc,
		documentTemplate: standardDoc,
		collectionDocs: reorderedTableRows,
		documents: cleanDocuments(reorderedTableRows),
		bucketInfo: { databaseName: dbName, Procedures: schemaProcedures },
		modelDefinitions: { definitions: getUserDefinedTypes(tableInfo, databaseUDT) },
		emptyBucket: false,
		validation: { jsonSchema },
		views: [],
	};
};

const processView = async ({ processedTableResult, tableName, schemaName, jsonSchema, ...context }) => {
	const { client, dbName, logger } = context;

	const viewData = await prepareViewJSON({ client, dbName, viewName: tableName, schemaName, logger, jsonSchema });
	const indexes = context.viewsIndexes.filter(
		index => index.TableName === tableName && index.schemaName === schemaName,
	);

	return {
		...processedTableResult,
		...viewData,
		data: {
			...(viewData.data || {}),
			Indxs: reverseTableIndexes({ tableIndexes: indexes }),
		},
	};
};

const reverseCollectionsToJSON = async ({ client, tablesInfo, reverseEngineeringOptions, logger }) => {
	const dbName = client.config.database;

	const {
		databaseIndexes,
		databaseMemoryOptimizedTables,
		databaseCheckConstraints,
		xmlSchemaCollections,
		databaseUDT,
		viewsIndexes,
		fullTextIndexes,
		spatialIndexes,
		procedures,
	} = await fetchDatabaseMetadata({ client, dbName, tablesInfo, logger, reverseEngineeringOptions });

	return processSchemas({
		tablesInfo,
		client,
		dbName,
		logger,
		reverseEngineeringOptions,
		databaseIndexes,
		databaseMemoryOptimizedTables,
		databaseCheckConstraints,
		xmlSchemaCollections,
		databaseUDT,
		viewsIndexes,
		fullTextIndexes,
		spatialIndexes,
		procedures,
	});
};

const logDatabaseVersion = async ({ client, logger }) => {
	const versionInfo = await getVersionInfo({ client, dbName: client.config.database, logger });

	logger.log('info', { dbVersion: versionInfo }, 'Database version');
};

module.exports = {
	reverseCollectionsToJSON,
	mergeCollectionsWithViews,
	getCollectionsRelationships,
	logDatabaseVersion,
};
