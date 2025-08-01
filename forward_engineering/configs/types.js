module.exports = {
	TINYINT: {
		capacity: 1,
	},
	SMALLINT: {
		capacity: 2,
	},
	INT: {
		capacity: 4,
	},
	BIGINT: {
		capacity: 8,
	},
	FLOAT: {
		capacity: 8,
		mode: 'floating',
	},
	REAL: {
		capacity: 4,
		mode: 'floating',
	},
	DECIMAL: {
		capacity: 16,
		mode: 'decimal',
	},
	NUMERIC: {
		capacity: 12,
		mode: 'decimal',
	},
	MONEY: {
		capacity: 8,
		mode: 'decimal',
	},
	SMALLMONEY: {
		capacity: 4,
		mode: 'decimal',
	},
	CHAR: {
		size: 1,
	},
	VARCHAR: {
		mode: 'varying',
	},
	NCHAR: {
		size: 1,
		encoding: 'utf-8',
	},
	NVARCHAR: {
		encoding: 'utf-8',
	},
	TEXT: {
		mode: 'text',
	},
	NTEXT: {
		mode: 'text',
		encoding: 'utf-8',
	},
	DATE: {
		format: 'YYYY-MM-DD',
	},
	DATETIME: {
		format: 'YYYY-MM-DD hh:mm:ss',
	},
	DATETIME2: {
		format: 'YYYY-MM-DD hh:mm:ss.nnn',
	},
	DATETIMEOFFSET: {
		format: 'YYYY-MM-DD hh:mm:ss.nnnZ',
	},
	SMALLDATETIME: {
		format: 'YYYY-MM-DD hh:mm:ss',
	},
	TIME: {
		format: 'hh:mm:ss',
	},
	TIMESTAMP: {
		format: 'YYYY-MM-DD hh:mm:ss',
	},
	BINARY: {
		size: 8000,
		mode: 'binary',
	},
	VARBINARY: {
		size: 2147483649,
		mode: 'binary',
	},
	IMAGE: {
		mode: 'binary',
	},
	BIT: {
		mode: 'boolean',
	},
	HIERARCHYID: {
		capacity: 5,
		mode: 'uuid',
	},
	UNIQUEIDENTIFIER: {
		mode: 'uuid',
	},
	SQL_VARIANT: {
		mode: 'variant',
	},
	XML: {
		mode: 'xml',
	},
	GEOMETRY: {
		format: 'euclidian',
		mode: 'geospatial',
	},
	GEOGRAPHY: {
		format: 'ellipsoidal',
		mode: 'geospatial',
	},
	ROWVERSION: {
		mode: 'version',
	},
	TABLE: {
		mode: 'table',
	},
	JSON: {
		format: 'semi-structured',
	},
};
