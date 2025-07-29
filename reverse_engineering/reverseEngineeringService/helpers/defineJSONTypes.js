const defineType = value => {
	try {
		const parsedValue = JSON.parse(value);
		if (Array.isArray(parsedValue)) {
			return 'array';
		}

		if (parsedValue !== null && typeof parsedValue === 'object') {
			return 'object';
		}

		return 'string';
	} catch (e) {
		return 'string';
	}
};

const handleField = (name, properties, cellValue) => {
	if (!cellValue || (properties.mode !== 'nvarchar' && properties.type !== 'json')) {
		return { [name]: properties };
	}

	const type = defineType(cellValue);
	if (type === 'array') {
		return {
			[name]: {
				...properties,
				subtype: type,
				items: [],
			},
		};
	}

	if (type === 'object') {
		return {
			[name]: {
				...properties,
				subtype: type,
				properties: {},
			},
		};
	}

	return {
		[name]: {
			...properties,
			subtype: type,
		},
	};
};

const defineJSONTypes = row => jsonSchema => {
	const [firstRow] = row;
	if (!firstRow) {
		return jsonSchema;
	}

	return {
		...jsonSchema,
		properties: Object.entries(jsonSchema.properties).reduce(
			(acc, [fieldName, fieldProperties]) => ({
				...acc,
				...handleField(fieldName, fieldProperties, getColumnValue(firstRow, fieldName, fieldProperties, row)),
			}),
			{},
		),
	};
};

const getColumnValue = (firstRow, fieldName, fieldProperties, rows) => {
	if (!['varchar', 'nvarchar', 'json'].includes(fieldProperties.mode)) {
		return firstRow[fieldName];
	}
	const complexValueRow = rows.find(row => {
		return typeof row[fieldName] === 'string' && (row[fieldName].startsWith('{') || row[fieldName].startsWith('['));
	});

	return complexValueRow ? complexValueRow[fieldName] : firstRow[fieldName];
};

module.exports = defineJSONTypes;
