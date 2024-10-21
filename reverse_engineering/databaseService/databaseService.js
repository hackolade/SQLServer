const axios = require('axios');
const sql = require('mssql');
const https = require('https');
const { getObjectsFromDatabase, getNewConnectionClientByDb } = require('./helpers');
const msal = require('@azure/msal-node');
const fs = require('fs');
const getSampleDocSize = require('../helpers/getSampleDocSize');

const QUERY_REQUEST_TIMEOUT = 60000;

const getSslConfig = connectionInfo => {
	const encrypt = connectionInfo.encryptConnection === undefined ? true : Boolean(connectionInfo.encryptConnection);

	if (connectionInfo.sslType === 'SYSTEMCA') {
		return {};
	}

	if (connectionInfo.sslType === 'TRUST_ALL_CERTIFICATES') {
		return {
			trustServerCertificate: true,
		};
	}

	if (connectionInfo.sslType === 'TRUST_CUSTOM_CA_SIGNED_CERTIFICATES') {
		return {
			cryptoCredentialsDetails: {
				ca: fs.readFileSync(connectionInfo.certAuthority),
			},
		};
	}

	if (connectionInfo.sslType === 'TRUST_SERVER_CLIENT_CERTIFICATES') {
		return {
			cryptoCredentialsDetails: {
				ca: fs.readFileSync(connectionInfo.certAuthority),
				cert: connectionInfo.clientCert && fs.readFileSync(connectionInfo.clientCert),
				key: connectionInfo.clientPrivateKey && fs.readFileSync(connectionInfo.clientPrivateKey),
				passphrase: connectionInfo.passphrase,
			},
		};
	}

	return {};
};

const getConnectionClient = async (connectionInfo, logger) => {
	const hostName = getHostName(connectionInfo.host);
	const userName =
		isEmail(connectionInfo.userName) && hostName
			? `${connectionInfo.userName}@${hostName}`
			: connectionInfo.userName;
	const tenantId = connectionInfo.connectionTenantId || connectionInfo.tenantId || 'common';
	const clientId = connectionInfo.clientId;
	const sslOptions = getSslConfig(connectionInfo);

	if (connectionInfo.authMethod === 'Username / Password') {
		return await sql.connect({
			user: userName,
			password: connectionInfo.userPassword,
			server: connectionInfo.host,
			port: +connectionInfo.port,
			database: connectionInfo.databaseName,
			options: {
				enableArithAbort: true,
				encrypt:
					connectionInfo.encryptConnection === undefined ? true : Boolean(connectionInfo.encryptConnection),
				...sslOptions,
			},
			connectTimeout: Number(connectionInfo.queryRequestTimeout) || 60000,
			requestTimeout: Number(connectionInfo.queryRequestTimeout) || 60000,
		});
	} else if (connectionInfo.authMethod === 'Username / Password (Windows)') {
		return await sql.connect({
			user: userName,
			password: connectionInfo.userPassword,
			server: connectionInfo.host,
			port: +connectionInfo.port,
			database: connectionInfo.databaseName,
			domain: connectionInfo.userDomain,
			options: {
				...sslOptions,
				encrypt:
					connectionInfo.encryptWindowsConnection === undefined
						? false
						: Boolean(connectionInfo.encryptWindowsConnection),
				enableArithAbort: true,
			},
			connectTimeout: Number(connectionInfo.queryRequestTimeout) || 60000,
			requestTimeout: Number(connectionInfo.queryRequestTimeout) || 60000,
		});
	} else if (connectionInfo.authMethod === 'Azure Active Directory (MFA)') {
		const clientId = '0dc36597-bc44-49f8-a4a7-ae5401959b85';
		const redirectUri = 'http://localhost:8080';
		const token = await getToken({ connectionInfo, tenantId, clientId, redirectUri, logger });

		return await sql.connect({
			server: connectionInfo.host,
			port: +connectionInfo.port,
			database: connectionInfo.databaseName,
			options: {
				...sslOptions,
				encrypt: true,
				enableArithAbort: true,
			},
			authentication: {
				type: 'azure-active-directory-access-token',
				options: {
					token,
				},
			},
			connectTimeout: QUERY_REQUEST_TIMEOUT,
			requestTimeout: QUERY_REQUEST_TIMEOUT,
		});
	} else if (connectionInfo.authMethod === 'Azure Active Directory (Username / Password)') {
		return await sql.connect({
			user: userName,
			password: connectionInfo.userPassword,
			server: connectionInfo.host,
			port: +connectionInfo.port,
			database: connectionInfo.databaseName,
			options: {
				...sslOptions,
				encrypt: true,
				enableArithAbort: true,
			},
			authentication: {
				type: 'azure-active-directory-password',
				options: {
					userName: connectionInfo.userName,
					password: connectionInfo.userPassword,
					domain: tenantId,
					clientId,
				},
			},
			connectTimeout: Number(connectionInfo.queryRequestTimeout) || 60000,
			requestTimeout: Number(connectionInfo.queryRequestTimeout) || 60000,
		});
	}

	return await sql.connect(connectionInfo.connectionString);
};

const isEmail = name => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name || '');

const getHostName = url => (url || '').split('.')[0];

const PERMISSION_DENIED_CODE = 297;

const addPermissionDeniedMetaData = (error, meta) => {
	error.message =
		'The user does not have permission to perform ' +
		meta.action +
		'. Please, check the access to the next objects: ' +
		meta.objects.join(', ');

	return error;
};

const getClient = async (connectionClient, dbName, meta, logger) => {
	let currentDbConnectionClient = await getNewConnectionClientByDb(connectionClient, dbName);

	const _inst = {
		request(...args) {
			currentDbConnectionClient = currentDbConnectionClient.request(...args);
			return _inst;
		},
		input(...args) {
			currentDbConnectionClient = currentDbConnectionClient.input(...args);
			return _inst;
		},
		async query(...queryParams) {
			try {
				return await currentDbConnectionClient.query(...queryParams);
			} catch (error) {
				if (meta) {
					if (error.number === PERMISSION_DENIED_CODE) {
						error = addPermissionDeniedMetaData(error, meta);
					}

					if (meta.skip) {
						logger.log(
							'error',
							{ message: error.message, stack: error.stack, error },
							'Perform ' + meta.action,
						);
						logger.progress({ message: 'Failed: ' + meta.action, containerName: dbName, entityName: '' });

						return [];
					}
				}

				throw error;
			}
		},
	};

	return _inst;
};

const getVersionInfo = async (connectionClient, dbName, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting version info',
			objects: ['VersionInfo'],
		},
		logger,
	);

	try {
		return mapResponse(await currentDbConnectionClient.query`SELECT @@VERSION VersionInfo;`);
	} catch (e) {
		logger.log('error', { message: e.message, stack: e.stack, error: e }, 'Perform: SELECT @@VERSION VersionInfo;');

		try {
			return mapResponse(await currentDbConnectionClient.query`EXEC xp_msver;`);
		} catch (e) {
			logger.log('error', { message: e.message, stack: e.stack, error: e }, 'Perform: EXEC xp_msver;');

			return [];
		}
	}
};

const getTableInfo = async (connectionClient, dbName, tableName, tableSchema, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'table information query',
			objects: ['INFORMATION_SCHEMA.COLUMNS', 'sys.identity_columns', 'sys.objects'],
		},
		logger,
	);
	const objectId = `${tableSchema}.${tableName}`;
	return mapResponse(
		await currentDbConnectionClient.query`
		SELECT c.*,
				ic.SEED_VALUE,
				ic.INCREMENT_VALUE,
				COLUMNPROPERTY(OBJECT_ID(${objectId}), c.column_name, 'IsSparse') AS IS_SPARSE,
				COLUMNPROPERTY(OBJECT_ID(${objectId}), c.column_name, 'IsIdentity') AS IS_IDENTITY,
				o.type AS TABLE_TYPE
		FROM INFORMATION_SCHEMA.COLUMNS AS c
		LEFT JOIN sys.identity_columns ic ON ic.object_id=OBJECT_ID(${objectId})
		LEFT JOIN sys.objects o ON o.object_id=OBJECT_ID(${objectId})
		WHERE c.table_name = ${tableName}
		AND c.table_schema = ${tableSchema}
	;`,
	);
};

const getTableSystemTime = async (connectionClient, dbName, tableName, tableSchema, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'table information query',
			objects: ['sys.periods'],
			skip: true,
		},
		logger,
	);
	const objectId = `${tableSchema}.${tableName}`;
	return mapResponse(
		await currentDbConnectionClient.query`
		SELECT col_name(p.object_id, p.start_column_id)                                          as startColumn,
		COLUMNPROPERTY(p.object_id, col_name(p.object_id, p.start_column_id), 'IsHidden') as startColumnIsHidden,
		col_name(p.object_id, p.end_column_id)                                            as endColumn,
		COLUMNPROPERTY(p.object_id, col_name(p.object_id, p.start_column_id), 'IsHidden') as endColumnIsHidden
		FROM sys.periods p
		WHERE p.object_id = OBJECT_ID(${objectId})
		AND p.period_type = 1;
	;`,
	);
};

const getTableRow = async (connectionClient, dbName, tableName, tableSchema, recordSamplingSettings, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting data query',
			objects: [`[${tableSchema}].[${tableName}]`],
			skip: true,
		},
		logger,
	);
	let amount;

	if (recordSamplingSettings.active === 'absolute') {
		amount = Number(recordSamplingSettings.absolute.value);
		logger.log(
			'info',
			{ message: `Get ${amount} rows from '${tableName}' table for sampling JSON data.` },
			'Reverse Engineering',
		);
	} else {
		const rowCount = await getTableRowCount(tableSchema, tableName, currentDbConnectionClient);
		amount = getSampleDocSize(rowCount, recordSamplingSettings);
		logger.log(
			'info',
			{ message: `Get ${amount} rows of total ${rowCount} from '${tableName}' table for sampling JSON data.` },
			'Reverse Engineering',
		);
	}

	return mapResponse(
		await currentDbConnectionClient
			.request()
			.input('tableName', sql.VarChar, tableName)
			.input('tableSchema', sql.VarChar, tableSchema)
			.input('amount', sql.Int, amount)
			.query`EXEC('SELECT TOP '+ @Amount +' * FROM [' + @TableSchema + '].[' + @TableName + '];');`,
	);
};

const getTableForeignKeys = async (connectionClient, dbName, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting foreign keys query',
			objects: [
				'sys.foreign_key_columns',
				'sys.foreign_keys',
				'sys.objects',
				'sys.tables',
				'sys.schemas',
				'sys.columns',
			],
			skip: true,
		},
		logger,
	);
	return mapResponse(
		await currentDbConnectionClient.query`
		SELECT obj.name AS FK_NAME,
				sch.name AS [schema_name],
				tab1.name AS [table],
				col1.name AS [column],
				tab2.name AS [referenced_table],
				col2.name AS [referenced_column],
				fk.delete_referential_action_desc AS on_delete,
				fk.update_referential_action_desc AS on_update
		FROM sys.foreign_key_columns fkc
		INNER JOIN sys.objects obj
			ON obj.object_id = fkc.constraint_object_id
		INNER JOIN sys.tables tab1
			ON tab1.object_id = fkc.parent_object_id
		INNER JOIN sys.schemas sch
			ON tab1.schema_id = sch.schema_id
		INNER JOIN sys.columns col1
			ON col1.column_id = parent_column_id AND col1.object_id = tab1.object_id
		INNER JOIN sys.tables tab2
			ON tab2.object_id = fkc.referenced_object_id
		INNER JOIN sys.columns col2
			ON col2.column_id = referenced_column_id AND col2.object_id = tab2.object_id
		INNER JOIN sys.foreign_keys fk
			ON fk.object_id = obj.object_id
		`,
	);
};

const getDatabaseIndexes = async (connectionClient, dbName, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting indexes query',
			objects: ['sys.indexes', 'sys.tables', 'sys.index_columns', 'sys.partitions'],
			skip: true,
		},
		logger,
	);

	logger.log('info', { message: `Get '${dbName}' database indexes.` }, 'Reverse Engineering');

	return mapResponse(
		await currentDbConnectionClient.query`
		SELECT
			TableName = t.name,
			IndexName = ind.name,
			ic.is_descending_key,
			ic.is_included_column,
			COL_NAME(t.object_id, ic.column_id) AS columnName,
			OBJECT_SCHEMA_NAME(t.object_id) AS schemaName,
			p.data_compression_desc AS dataCompression,
			ind.*
		FROM sys.indexes ind
		LEFT JOIN sys.tables t
			ON ind.object_id = t.object_id
		INNER JOIN sys.index_columns ic
			ON ind.object_id = ic.object_id AND ind.index_id = ic.index_id
		INNER JOIN sys.partitions p
			ON p.object_id = t.object_id AND ind.index_id = p.index_id
		WHERE
			ind.is_primary_key = 0
			AND ind.is_unique_constraint = 0
			AND t.is_ms_shipped = 0
		`,
	);
};

const getIndexesBucketCount = async (connectionClient, dbName, indexesId, logger) => {
	if (!indexesId.length) {
		return [];
	}

	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting total buckets of indexes',
			objects: ['sys.dm_db_xtp_hash_index_stats'],
			skip: true,
		},
		logger,
	);

	return mapResponse(
		await currentDbConnectionClient.query(`
		SELECT hs.total_bucket_count, hs.index_id
		FROM sys.dm_db_xtp_hash_index_stats hs
		WHERE hs.index_id IN (${indexesId.join(', ')})`),
	);
};

const getSpatialIndexes = async (connectionClient, dbName, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting spatial indexes',
			objects: [
				'sys.spatial_indexes',
				'sys.tables',
				'sys.index_columns',
				'sys.partitions',
				'sys.spatial_index_tessellations',
			],
			skip: true,
		},
		logger,
	);

	logger.log('info', { message: `Get '${dbName}' database spatial indexes.` }, 'Reverse Engineering');

	return mapResponse(
		await currentDbConnectionClient.query`
		SELECT
			TableName = t.name,
			IndexName = ind.name,
			COL_NAME(t.object_id, ic.column_id) AS columnName,
			OBJECT_SCHEMA_NAME(t.object_id) AS schemaName,
			sit.bounding_box_xmin AS XMIN,
			sit.bounding_box_ymin AS YMIN,
			sit.bounding_box_xmax AS XMAX,
			sit.bounding_box_ymax AS YMAX,
			sit.level_1_grid_desc AS LEVEL_1,
			sit.level_2_grid_desc AS LEVEL_2,
			sit.level_3_grid_desc AS LEVEL_3,
			sit.level_4_grid_desc AS LEVEL_4,
			sit.cells_per_object AS CELLS_PER_OBJECT,
			p.data_compression_desc AS dataCompression,
			ind.*
		FROM sys.spatial_indexes ind
		LEFT JOIN sys.tables t
			ON ind.object_id = t.object_id
		INNER JOIN sys.index_columns ic
			ON ind.object_id = ic.object_id AND ind.index_id = ic.index_id
		LEFT JOIN sys.spatial_index_tessellations sit
			ON ind.object_id = sit.object_id AND ind.index_id = sit.index_id
		LEFT JOIN sys.partitions p
			ON p.object_id = t.object_id AND ind.index_id = p.index_id`,
	);
};

const getFullTextIndexes = async (connectionClient, dbName, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting full text indexes',
			objects: [
				'sys.fulltext_indexes',
				'sys.fulltext_index_columns',
				'sys.indexes',
				'sys.fulltext_stoplists',
				'sys.registered_search_property_lists',
				'sys.filegroups',
				'sys.fulltext_catalogs',
			],
			skip: true,
		},
		logger,
	);

	logger.log('info', { message: `Get '${dbName}' database full text indexes.` }, 'Reverse Engineering');

	const result = await currentDbConnectionClient.query`
		SELECT
			OBJECT_SCHEMA_NAME(F.object_id) AS schemaName,
			OBJECT_NAME(F.object_id) AS TableName,
			COL_NAME(FC.object_id, FC.column_id) AS columnName,
			COL_NAME(FC.object_id, FC.type_column_id) AS columnTypeName,
			FC.statistical_semantics AS statistical_semantics,
			FC.language_id AS language,
			I.name AS indexKeyName,
			F.change_tracking_state_desc AS changeTracking,
			CASE WHEN F.stoplist_id IS NULL THEN 'OFF' WHEN F.stoplist_id = 0 THEN 'SYSTEM' ELSE SL.name END AS stopListName,
			SPL.name AS searchPropertyList,
			FG.name AS fileGroup,
			FCAT.name AS catalogName,
			type = 'FullText',
			IndexName = 'full_text_idx'
		FROM sys.fulltext_indexes F
		INNER JOIN sys.fulltext_index_columns FC ON FC.object_id = F.object_id
		LEFT JOIN sys.indexes I ON F.unique_index_id = I.index_id AND I.object_id = F.object_id
		LEFT JOIN sys.fulltext_stoplists SL ON SL.stoplist_id = F.stoplist_id
		LEFT JOIN sys.registered_search_property_lists SPL ON SPL.property_list_id = F.property_list_id
		LEFT JOIN sys.filegroups FG ON FG.data_space_id = F.data_space_id
		LEFT JOIN sys.fulltext_catalogs FCAT ON FCAT.fulltext_catalog_id = F.fulltext_catalog_id
		WHERE F.is_enabled = 1`;

	return mapResponse(result);
};

const getViewsIndexes = async (connectionClient, dbName, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting view indexes query',
			objects: ['sys.indexes', 'sys.views', 'sys.index_columns', 'sys.partitions'],
			skip: true,
		},
		logger,
	);

	logger.log('info', { message: `Get '${dbName}' database views indexes.` }, 'Reverse Engineering');

	return mapResponse(
		await currentDbConnectionClient.query`
		SELECT
			TableName = t.name,
			IndexName = ind.name,
			ic.is_descending_key,
			ic.is_included_column,
			COL_NAME(t.object_id, ic.column_id) AS columnName,
			OBJECT_SCHEMA_NAME(t.object_id) AS schemaName,
			p.data_compression_desc AS dataCompression,
			ind.*
		FROM sys.indexes ind
		LEFT JOIN sys.views t
			ON ind.object_id = t.object_id
		INNER JOIN sys.index_columns ic
			ON ind.object_id = ic.object_id AND ind.index_id = ic.index_id
		INNER JOIN sys.partitions p
			ON p.object_id = t.object_id AND ind.index_id = p.index_id
		WHERE
			ind.is_primary_key = 0
			AND ind.is_unique_constraint = 0
			AND t.is_ms_shipped = 0
		`,
	);
};

const getTableColumnsDescription = async (connectionClient, dbName, tableName, schemaName, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting table columns description',
			objects: ['sys.tables', 'sys.columns', 'sys.extended_properties'],
			skip: true,
		},
		logger,
	);

	logger.log('info', { message: `Get '${tableName}' table columns description.` }, 'Reverse Engineering');

	return mapResponse(currentDbConnectionClient.query`
		SELECT
			st.name [Table],
			sc.name [Column],
			sep.value [Description]
		FROM sys.tables st
		INNER JOIN sys.columns sc ON st.object_id = sc.object_id
		LEFT JOIN sys.extended_properties sep ON st.object_id = sep.major_id
														AND sc.column_id = sep.minor_id
														AND sep.name = 'MS_Description'
		WHERE st.name = ${tableName}
		AND st.schema_id=SCHEMA_ID(${schemaName})
	`);
};

const getDatabaseMemoryOptimizedTables = async (connectionClient, dbName, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting memory optimized tables',
			objects: ['sys.tables', 'sys.objects'],
			skip: true,
		},
		logger,
	);

	logger.log('info', { message: `Get '${dbName}' database memory optimized indexes.` }, 'Reverse Engineering');

	return mapResponse(
		await currentDbConnectionClient.query`
		SELECT
			T.name,
			T.durability,
			T.durability_desc,
			OBJECT_NAME(T.history_table_id) AS history_table,
			SCHEMA_NAME(O.schema_id) AS history_schema,
			T.temporal_type_desc,
			T.is_memory_optimized
		FROM sys.tables T LEFT JOIN sys.objects O ON T.history_table_id = O.object_id
	`,
	);
};

const getDatabaseCheckConstraints = async (connectionClient, dbName, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting check constraints',
			objects: ['sys.check_constraints', 'sys.objects', 'sys.all_columns'],
			skip: true,
		},
		logger,
	);

	logger.log('info', { message: `Get '${dbName}' database check constraints.` }, 'Reverse Engineering');

	return mapResponse(currentDbConnectionClient.query`
		SELECT con.[name],
			t.[name] AS [table],
			col.[name] AS column_name,
			con.[definition],
			con.[is_not_trusted],
			con.[is_disabled],
			con.[is_not_for_replication]
		FROM sys.check_constraints con
		LEFT OUTER JOIN sys.objects t
			ON con.parent_object_id = t.object_id
		LEFT OUTER JOIN sys.all_columns col
			ON con.parent_column_id = col.column_id
			AND con.parent_object_id = col.object_id
	`);
};

const getViewTableInfo = async (connectionClient, dbName, viewName, schemaName, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'information view query',
			objects: ['sys.sql_dependencies', 'sys.objects', 'sys.columns', 'sys.types'],
			skip: true,
		},
		logger,
	);

	logger.log('info', { message: `Get '${viewName}' view table info.` }, 'Reverse Engineering');

	const objectId = `${schemaName}.${viewName}`;
	return mapResponse(currentDbConnectionClient.query`
		SELECT
			ViewName = O.name,
			ColumnName = A.name,
			ReferencedSchemaName = SCHEMA_NAME(X.schema_id),
			ReferencedTableName = X.name,
			ReferencedColumnName = C.name,
			T.is_selected,
			T.is_updated,
			T.is_select_all,
			ColumnType = M.name,
			M.max_length,
			M.precision,
			M.scale
		FROM
			sys.sql_dependencies AS T
			INNER JOIN sys.objects AS O ON T.object_id = O.object_id
			INNER JOIN sys.objects AS X ON T.referenced_major_id = X.object_id
			INNER JOIN sys.columns AS C ON
				C.object_id = X.object_id AND
				C.column_id = T.referenced_minor_id
			INNER JOIN sys.types AS M ON
				M.system_type_id = C.system_type_id AND
				M.user_type_id = C.user_type_id
			INNER JOIN sys.columns AS A ON
				A.object_id = OBJECT_ID(${objectId}) AND
				T.referenced_minor_id = A.column_id
		WHERE
			O.type = 'V'
		AND
			O.name = ${viewName}
		AND O.schema_id=SCHEMA_ID(${schemaName})
		ORDER BY
			O.name,
			X.name,
			C.name
	`);
};

const getViewColumnRelations = async (connectionClient, dbName, viewName, schemaName, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting view column relations',
			objects: ['sys.dm_exec_describe_first_result_set'],
			skip: true,
		},
		logger,
	);

	logger.log('info', { message: `Get '${viewName}' view column relations.` }, 'Reverse Engineering');

	return mapResponse(currentDbConnectionClient
		.request()
		.input('tableName', sql.VarChar, viewName)
		.input('tableSchema', sql.VarChar, schemaName).query`
			SELECT name, source_database, source_schema,
				source_table, source_column
				FROM sys.dm_exec_describe_first_result_set(N'SELECT TOP 1 * FROM [' + @TableSchema + '].[' + @TableName + ']', NULL, 1)
			WHERE is_hidden=0
	`);
};

const getViewStatement = async (connectionClient, dbName, viewName, schemaName, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting view statements',
			objects: ['sys.sql_modules', 'sys.views'],
			skip: true,
		},
		logger,
	);

	logger.log('info', { message: `Get '${viewName}' view statement.` }, 'Reverse Engineering');

	const objectId = `${schemaName}.${viewName}`;
	return mapResponse(currentDbConnectionClient.query`SELECT M.*, V.with_check_option
			FROM sys.sql_modules M INNER JOIN sys.views V ON M.object_id=V.object_id
			WHERE M.object_id=OBJECT_ID(${objectId})
		`);
};

const getTableKeyConstraints = async (connectionClient, dbName, tableName, schemaName, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting constraints of keys',
			objects: [
				'INFORMATION_SCHEMA.TABLE_CONSTRAINTS',
				'INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE',
				'sys.indexes',
				'sys.stats',
				'sys.data_spaces',
				'sys.index_columns',
				'sys.partitions',
			],
			skip: true,
		},
		logger,
	);

	logger.log('info', { message: `Get '${tableName}' table key constraints.` }, 'Reverse Engineering');

	const objectId = `${schemaName}.${tableName}`;
	return mapResponse(
		await currentDbConnectionClient.query`
		SELECT TC.TABLE_NAME AS tableName, TC.Constraint_Name AS constraintName,
		CC.Column_Name AS columnName, TC.constraint_type AS constraintType, ind.type_desc AS typeDesc,
		p.data_compression_desc AS dataCompression,
		ds.name AS dataSpaceName,
		st.no_recompute AS statisticNoRecompute, st.is_incremental AS statisticsIncremental,
		ic.is_descending_key AS isDescending,
		ind.*
		FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS TC
		INNER JOIN INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE CC ON TC.Constraint_Name = CC.Constraint_Name
			AND TC.TABLE_NAME=${tableName} AND TC.TABLE_SCHEMA=${schemaName}
		INNER JOIN sys.indexes ind ON ind.name = TC.CONSTRAINT_NAME
		INNER JOIN sys.stats st ON st.name = TC.CONSTRAINT_NAME
		LEFT JOIN sys.data_spaces ds ON ds.data_space_id = ind.data_space_id
		INNER JOIN sys.index_columns ic ON ic.object_id = OBJECT_ID(${objectId})
			AND ind.index_id=ic.index_id
			AND ic.column_id=COLUMNPROPERTY(OBJECT_ID(${objectId}), CC.column_name, 'ColumnId')
		INNER JOIN sys.partitions p ON p.object_id = OBJECT_ID(${objectId}) AND p.index_id = ind.index_id
		ORDER BY TC.Constraint_Name
	`,
	);
};

const getTableMaskedColumns = async (connectionClient, dbName, tableName, schemaName, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting masked columns',
			objects: ['sys.masked_columns'],
			skip: true,
		},
		logger,
	);

	logger.log('info', { message: `Get '${tableName}' table masked columns.` }, 'Reverse Engineering');

	const objectId = `${schemaName}.${tableName}`;
	return mapResponse(
		await currentDbConnectionClient.query`
		SELECT name, masking_function FROM sys.masked_columns
		WHERE object_id=OBJECT_ID(${objectId})
	`,
	);
};

const getDatabaseXmlSchemaCollection = async (connectionClient, dbName, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting xml schema collections',
			objects: ['sys.column_xml_schema_collection_usages', 'sys.xml_schema_collections'],
			skip: true,
		},
		logger,
	);

	logger.log('info', { message: `Get '${dbName}' database xml schema collection.` }, 'Reverse Engineering');

	return mapResponse(
		await currentDbConnectionClient.query`
		SELECT xsc.name AS collectionName,
				SCHEMA_NAME(xsc.schema_id) AS schemaName,
				OBJECT_NAME(xcu.object_id) AS tableName,
				COL_NAME(xcu.object_id, xcu.column_id) AS columnName
		FROM sys.column_xml_schema_collection_usages xcu
		LEFT JOIN sys.xml_schema_collections xsc ON xsc.xml_collection_id=xcu.xml_collection_id
	`,
	);
};

const getTableDefaultConstraintNames = async (connectionClient, dbName, tableName, schemaName, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting default cosntraint names',
			objects: ['sys.all_columns', 'sys.tables', 'sys.schemas', 'sys.default_constraints'],
			skip: true,
		},
		logger,
	);

	logger.log('info', { message: `Get '${tableName}' table default constraint names.` }, 'Reverse Engineering');

	return mapResponse(
		await currentDbConnectionClient.query`
	SELECT
		ac.name AS columnName,
		dc.name
	FROM 
		sys.all_columns AS ac
			INNER JOIN
		sys.tables
			ON ac.object_id = tables.object_id
			INNER JOIN 
		sys.schemas
			ON tables.schema_id = schemas.schema_id
			INNER JOIN
		sys.default_constraints AS dc
			ON ac.default_object_id = dc.object_id
	WHERE 
			schemas.name = ${schemaName}
		AND tables.name = ${tableName}
	`,
	);
};

const getDatabaseUserDefinedTypes = async (connectionClient, dbName, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting user defined types',
			objects: ['sys.types'],
			skip: true,
		},
		logger,
	);

	logger.log('info', { message: `Get '${dbName}' database UDTs.` }, 'Reverse Engineering');

	return mapResponse(currentDbConnectionClient.query`
		SELECT * FROM sys.types
		WHERE is_user_defined = 1
	`);
};

const getDatabaseCollationOption = async (connectionClient, dbName, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'getting database collation',
			objects: [],
			skip: true,
		},
		logger,
	);

	return mapResponse(
		currentDbConnectionClient.query(`SELECT CONVERT (varchar(256), DATABASEPROPERTYEX('${dbName}','collation'));`),
	);
};

const mapResponse = async (response = {}) => {
	const resp = await response;

	return resp.recordset ? resp.recordset : resp;
};

const getTokenByMSAL = async ({ connectionInfo, redirectUri, clientId, tenantId, logger }) => {
	try {
		const pca = new msal.PublicClientApplication(getAuthConfig(clientId, tenantId, logger.log));
		const tokenRequest = {
			code: connectionInfo?.externalBrowserQuery?.code || '',
			scopes: ['https://database.windows.net//.default'],
			redirectUri,
			codeVerifier: connectionInfo?.proofKey,
			clientInfo: connectionInfo?.externalBrowserQuery?.client_info || '',
		};

		const responseData = await pca.acquireTokenByCode(tokenRequest);

		return responseData.accessToken;
	} catch (error) {
		logger.log('error', { message: error.message, stack: error.stack, error }, 'MFA MSAL auth error');
		return '';
	}
};

const getAgent = (reject, cert, key) => {
	return new https.Agent({ cert, key, rejectUnauthorized: !!reject });
};

const getTokenByAxios = async ({ connectionInfo, tenantId, redirectUri, clientId, logger, agent }) => {
	try {
		const params = new URLSearchParams();
		params.append('code', connectionInfo?.externalBrowserQuery?.code || '');
		params.append('client_id', clientId);
		params.append('redirect_uri', redirectUri);
		params.append('grant_type', 'authorization_code');
		params.append('code_verifier', connectionInfo?.proofKey);
		params.append('resource', 'https://database.windows.net/');

		const responseData = await axios.post(`https://login.microsoftonline.com/${tenantId}/oauth2/token`, params, {
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			...(agent && { httpsAgent: agent }),
		});

		return responseData?.data?.access_token || '';
	} catch (error) {
		logger.log('error', { message: error.message, stack: error.stack, error }, 'MFA Axios auth error');
		return '';
	}
};

const getTokenByAxiosExtended = params => {
	return getTokenByAxios({ ...params, agent: getAgent() });
};

const getToken = async ({ connectionInfo, tenantId, clientId, redirectUri, logger }) => {
	const axiosExtendedToken = await getTokenByAxiosExtended({
		connectionInfo,
		clientId,
		redirectUri,
		tenantId,
		logger,
	});
	if (axiosExtendedToken) {
		return axiosExtendedToken;
	}

	const msalToken = await getTokenByMSAL({ connectionInfo, clientId, redirectUri, tenantId, logger });
	if (msalToken) {
		return msalToken;
	}

	const axiosToken = await getTokenByAxios({ connectionInfo, clientId, redirectUri, tenantId, logger });
	if (axiosToken) {
		return axiosToken;
	}

	return;
};

const getAuthConfig = (clientId, tenantId, logger) => ({
	system: {
		loggerOptions: {
			loggerCallback(loglevel, message) {
				logger(message);
			},
			piiLoggingEnabled: false,
			logLevel: msal.LogLevel.Verbose,
		},
	},
	auth: {
		clientId,
		authority: `https://login.microsoftonline.com/${tenantId}`,
	},
});

const getDescriptionComments = async (connectionClient, dbName, { schema, entity }, logger) => {
	const currentDbConnectionClient = await getClient(
		connectionClient,
		dbName,
		{
			action: 'MS_Description query',
			objects: [],
		},
		logger,
	);

	logger.log('info', { message: `Get description comments for '${entity?.name}'.` }, 'Reverse Engineering');

	const commentsRequestResponse = await currentDbConnectionClient.query(
		buildDescriptionCommentsRetrieveQuery({ schema, entity }),
	);

	return { ...commentsRequestResponse.recordset[0], schema, entityName: entity?.name };
};

const buildDescriptionCommentsRetrieveQuery = ({ schema, entity }) => {
	const schemaTemplate = schema ? `'schema', '${schema}'` : `'schema', default`;

	if (!entity?.type) {
		return `SELECT objtype, objname, value FROM fn_listextendedproperty ('MS_Description', ${schemaTemplate}, NULL, NULL, NULL, NULL);`;
	}

	const entityTemplate = entity?.name
		? `'${entity.type}', '${entity.name}', 'column', default`
		: `'${entity.type}', default, NULL, NULL`;
	return `SELECT objtype, objname, value FROM fn_listextendedproperty ('MS_Description', ${schemaTemplate}, ${entityTemplate});`;
};

module.exports = {
	getConnectionClient,
	getObjectsFromDatabase,
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
	getDatabaseCollationOption,
	getTableSystemTime,
	getVersionInfo,
	getDescriptionComments,
};

async function getTableRowCount(tableSchema, tableName, currentDbConnectionClient) {
	const rowCountQuery = `SELECT COUNT(*) as rowsCount FROM [${tableSchema}].[${tableName}]`;
	const rowCountResponse = await currentDbConnectionClient.query(rowCountQuery);
	const rowCount = rowCountResponse?.recordset[0]?.rowsCount;

	return rowCount;
}
