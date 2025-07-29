module.exports = {
	createDatabase: 'CREATE DATABASE [${name}];',

	useDatabase: 'USE [${name}]${terminator}',

	createSchema: 'CREATE SCHEMA [${name}]${terminator}${comment}',

	createTable:
		'CREATE${external} TABLE ${name} (\n' +
		'\t${column_definitions}${temporalTableTime}${keyConstraints}${checkConstraints}${foreignKeyConstraints}${memoryOptimizedIndexes}\n' +
		')${options}${terminator}\n${comment}${columnComments}',

	columnDefinition:
		'[${name}] ${type}${primary_key}${temporalTableTime}${sparse}${maskedWithFunction}${identity}${collation}${not_null}${default}${encryptedWith}',
	computedColumnDefinition: '[${name}] AS ${expression}${persisted}${key}${not_null}',

	index:
		'CREATE${unique}${clustered}${columnstore} INDEX ${name}\n' +
		'\tON ${table}${keys}${include}${expression}${relational_index_option}${terminator}\n',

	fullTextIndex:
		'CREATE FULLTEXT INDEX ON ${table}${keys}\nKEY INDEX ${indexName}\n${catalog}${options}${terminator}\n',

	spatialIndex: 'CREATE SPATIAL INDEX ${name} ON ${table} (${column})${using}\n${options}${terminator}\n',

	checkConstraint: 'CONSTRAINT [${name}] ${check}${notForReplication} (${expression})',

	createForeignKeyConstraint:
		'CONSTRAINT ${name} FOREIGN KEY (${foreignKey}) REFERENCES ${primaryTable} (${primaryKey}) ${onDelete}${onUpdate}',

	createForeignKey:
		'ALTER TABLE ${foreignTable} ADD CONSTRAINT ${name} FOREIGN KEY (${foreignKey}) REFERENCES ${primaryTable} (${primaryKey})${onDelete}${onUpdate}${terminator}',

	createView:
		'CREATE${materialized} VIEW ${name}\n${view_attribute}AS ${select_statement}${check_option}${options}${terminator}\n${comment}',

	viewSelectStatement: 'SELECT ${keys}\n\tFROM ${tableName}\n',

	createUdtFromBaseType: 'CREATE TYPE ${name} FROM ${base_type}${not_null}${terminator}\n',

	createKeyConstraint: '${constraintName}${keyType}${clustered}${columns}${options}${partition}',

	createRegularPrimaryKeyConstraint: '${constraintName} PRIMARY KEY (${columnName})',
	createRegularUniqueKeyConstraint: '${constraintName} UNIQUE (${columnName})',

	createDefaultConstraint:
		'ALTER TABLE ${tableName} ADD CONSTRAINT [${constraintName}] DEFAULT (${default}) FOR [${columnName}]${terminator}\n',

	ifNotExistSchema:
		"IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'${schemaName}')\nbegin\n\tEXEC('${statement}')\nend${terminator}",

	ifNotExistDatabase:
		"IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = N'${databaseName}')\nbegin\n${statement}\nend${terminator}",

	ifNotExistTable:
		"IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'${tableName}') AND type in (N'U'))\nbegin\n${statement}\nend${terminator}\n",

	ifNotExistView:
		"IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'${viewName}') AND type in (N'V'))\nbegin\nEXEC('\n${statement}')\nend${terminator}",

	dropSchema: 'DROP SCHEMA IF EXISTS [${name}]${terminator}',

	dropTable: 'DROP TABLE IF EXISTS ${name}${terminator}',

	dropIndex: 'DROP INDEX IF EXISTS [${name}] ON ${object}${terminator}',

	dropConstraint: 'ALTER TABLE ${tableName} DROP CONSTRAINT ${constraintName}${terminator}',

	alterTableOptions: 'ALTER TABLE ${tableName} ${options}${terminator}',

	alterTable: 'ALTER TABLE ${tableName} ${command}${terminator}',

	dropColumn: 'DROP COLUMN [${name}]',

	addColumn: 'ADD ${script}',

	addCheckConstraint: 'ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} CHECK (${expression})${terminator}',

	addNotNullConstraint: 'ALTER TABLE ${tableName} ALTER COLUMN ${columnName} ${columnType} NOT NULL${terminator}',

	dropNotNullConstraint: 'ALTER TABLE ${tableName} ALTER COLUMN ${columnName} ${columnType} NULL${terminator}',

	addConstraint: 'ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintStatement}${terminator}',

	alterColumn: 'ALTER COLUMN [${name}] ${type}${collation}${not_null}',

	renameColumn: "EXEC sp_rename '${fullTableName}.${oldColumnName}', '${newColumnName}', 'COLUMN';${terminator}",

	dropView: 'DROP VIEW IF EXISTS ${name}${terminator}',

	alterView: 'ALTER VIEW ${name}${viewAttribute} AS ${selectStatement}${checkOption}${terminator}',

	dropType: 'DROP TYPE IF EXISTS ${name}${terminator}',

	createSchemaComment:
		"EXEC sp_addextendedproperty 'MS_Description', N'${value}', 'schema', ${schemaName}${terminator}",

	createTableComment:
		"EXEC sp_addextendedproperty 'MS_Description', N'${value}', 'schema', ${schemaName}, 'table', ${tableName}${terminator}",

	createColumnComment:
		"EXEC sp_addextendedproperty 'MS_Description', N'${value}', 'schema', ${schemaName}, 'table', ${tableName}, 'column', ${columnName}${terminator}",

	createViewComment:
		"EXEC sp_addextendedproperty 'MS_Description', N'${value}', 'schema', ${schemaName}, 'view', ${viewName}${terminator}",

	dropSchemaComment: "EXEC sp_dropextendedproperty 'MS_Description', 'schema', ${schemaName}${terminator}",

	dropTableComment:
		"EXEC sp_dropextendedproperty 'MS_Description', 'schema', ${schemaName}, 'table', ${tableName}${terminator}",

	dropColumnComment:
		"EXEC sp_dropextendedproperty 'MS_Description', 'schema', ${schemaName}, 'table', ${tableName}, 'column', ${columnName}${terminator}",

	dropViewComment:
		"EXEC sp_dropextendedproperty 'MS_Description', 'schema', ${schemaName}, 'view', ${viewName}${terminator}",

	updateSchemaComment:
		"EXEC sp_updateextendedproperty 'MS_Description', N'${value}', 'schema', ${schemaName}${terminator}",

	updateTableComment:
		"EXEC sp_updateextendedproperty 'MS_Description', N'${value}', 'schema', ${schemaName}, 'table', ${tableName}${terminator}",

	updateColumnComment:
		"EXEC sp_updateextendedproperty 'MS_Description', N'${value}', 'schema', ${schemaName}, 'table', ${tableName}, 'column', ${columnName}${terminator}",

	updateViewComment:
		"EXEC sp_updateextendedproperty 'MS_Description', N'${value}', 'schema', ${schemaName}, 'view', ${viewName}${terminator}",
};
