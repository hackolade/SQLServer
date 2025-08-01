const handleType = type => {
	switch (type) {
		case 'smalldatetime':
		case 'time':
		case 'timestamp':
		case 'datetimeoffset':
		case 'datetime2':
		case 'datetime':
		case 'date':
			return { type: 'datetime', mode: type };
		case 'image':
		case 'varbinary':
		case 'binary':
			return { type: 'binary', mode: type };
		case 'nchar':
		case 'ntext':
		case 'text':
		case 'char':
		case 'nvarchar':
		case 'varchar':
			return { type: 'char', mode: type };
		case 'decimal':
		case 'float':
		case 'money':
		case 'numeric':
		case 'real':
		case 'smallint':
		case 'smallmoney':
		case 'tinyint':
		case 'int':
		case 'bit':
		case 'bigint':
			return { type: 'numeric', mode: type };
		case 'geography':
		case 'geometry':
		case 'hierarchyid':
		case 'sql_variant':
		case 'uniqueidentifier':
		case 'xml':
		case 'cursor':
		case 'rowversion':
		case 'json':
		default:
			return { type };
	}
};

const handleDefault = (typeObject, value) => {
	if (!value) {
		return { default: '' };
	}

	const validValue = {
		numeric: Number(value.replace(/(^\(\()|(\)\)$)/g, '')),
		char: value.replace(/(^\(')|(('\))$)/g, ''),
		xml: value.replace(/(^\(N')|(('\))$)/g, ''),
	}[typeObject.type];

	return { default: validValue !== undefined ? validValue : value };
};

const handleMaxLengthDataTypes = (maxLength, typeObject) => {
	switch (typeObject.type) {
		case 'binary': {
			if (typeObject.mode === 'varbinary' && maxLength === -1) {
				return { ...typeObject, hasMaxLength: true };
			}

			return typeObject;
		}
		case 'char': {
			if ((typeObject.mode === 'varchar' || typeObject.mode === 'nvarchar') && maxLength === -1) {
				return { ...typeObject, hasMaxLength: true };
			}

			return typeObject;
		}
		default:
			return typeObject;
	}
};

const handleIdentity = (column, value) => {
	if (value !== 1) {
		return {};
	}

	return {
		identity: {
			identitySeed: column['SEED_VALUE'],
			identityIncrement: column['INCREMENT_VALUE'],
		},
	};
};

const handleColumnProperty = (column, propertyName, value) => {
	switch (propertyName) {
		case 'DATA_TYPE':
			return handleMaxLengthDataTypes(column['CHARACTER_MAXIMUM_LENGTH'], handleType(value));
		case 'CHARACTER_MAXIMUM_LENGTH':
			return { length: value };
		case 'COLUMN_DEFAULT':
			return handleDefault(handleType(column['DATA_TYPE']), value);
		case 'IS_NULLABLE':
			return { required: value === 'NO' };
		case 'DATETIME_PRECISION':
			return { fractSecPrecision: !isNaN(value) ? value : '' };
		case 'NUMERIC_SCALE':
			return { scale: !isNaN(value) ? value : '' };
		case 'NUMERIC_PRECISION':
			return { precision: !isNaN(value) ? value : '' };
		case 'IS_IDENTITY':
			return handleIdentity(column, value);
		case 'IS_SPARSE':
			return { sparse: Boolean(value) };
		default:
			return {};
	}
};

const reverseTableColumn = column =>
	Object.entries(column).reduce(
		(jsonSchema, [propertyName, value]) => ({
			...jsonSchema,
			...handleColumnProperty(column, propertyName, value),
		}),
		{},
	);

module.exports = reverseTableColumn;
