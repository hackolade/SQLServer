/**
 * @typedef {import('../types').ColumnDefinition} ColumnDefinition
 * @typedef {import('../types').JsonSchema} JsonSchema
 * @typedef {import('../types').ConstraintDto} ConstraintDto
 */

const _ = require('lodash');
const { clean } = require('../utils/general');

const mapProperties = (jsonSchema, iteratee) => {
	return Object.entries(jsonSchema.properties).map(iteratee);
};

const isInlineUnique = column => {
	return (
		isUnique(column) &&
		((column.uniqueKeyOptions?.length === 1 && !_.first(column.uniqueKeyOptions)?.constraintName) ||
			_.isEmpty(column.uniqueKeyOptions))
	);
};

const isInlinePrimaryKey = column => {
	return isPrimaryKey(column) && !column.primaryKeyOptions?.constraintName;
};

const isUnique = column => {
	if (column.compositeUniqueKey) {
		return false;
	} else if (!column.unique) {
		return false;
	} else {
		return true;
	}
};

const isPrimaryKey = column => {
	if (column.compositeUniqueKey) {
		return false;
	} else if (column.compositePrimaryKey) {
		return false;
	} else if (!column.primaryKey) {
		return false;
	} else {
		return true;
	}
};

const getOrder = order => {
	if (_.toLower(order) === 'asc') {
		return 'ASC';
	} else if (_.toLower(order) === 'desc') {
		return 'DESC';
	} else {
		return '';
	}
};

const hydrateUniqueOptions = (options, columnName, isActivated) =>
	clean({
		keyType: 'UNIQUE',
		name: options['constraintName'],
		columns: [
			{
				name: columnName,
				order: getOrder(options['order']),
				isActivated: isActivated,
			},
		],
		partition: options['partitionName'],
		clustered: options['clustered'],
		indexOption: clean({
			statisticsNoRecompute: options['staticticsNorecompute'],
			statisticsIncremental: options['statisticsIncremental'],
			ignoreDuplicateKey: options['ignoreDuplicate'],
			fillFactor: options['fillFactor'],
			allowRowLocks: options['allowRowLocks'],
			allowPageLocks: options['allowPageLocks'],
			optimizeForSequentialKey: options['isOptimizedForSequentialKey'],
			padIndex: options['isPadded'],
			dataCompression: options['dataCompression'],
		}),
	});

const hydratePrimaryKeyOptions = (options, columnName, isActivated) =>
	clean({
		keyType: 'PRIMARY KEY',
		name: options['constraintName'],
		columns: [
			{
				name: columnName,
				order: getOrder(options['order']),
				isActivated: isActivated,
			},
		],
		partition: options['partitionName'],
		clustered: options['clustered'],
		indexOption: clean({
			statisticsNoRecompute: options['staticticsNorecompute'],
			statisticsIncremental: options['statisticsIncremental'],
			ignoreDuplicateKey: options['ignoreDuplicate'],
			fillFactor: options['fillFactor'],
			allowRowLocks: options['allowRowLocks'],
			allowPageLocks: options['allowPageLocks'],
			optimizeForSequentialKey: options['isOptimizedForSequentialKey'],
			padIndex: options['isPadded'],
			dataCompression: options['dataCompression'],
		}),
	});

const findName = (keyId, properties) => {
	return Object.keys(properties).find(name => properties[name].GUID === keyId);
};

const checkIfActivated = (keyId, properties) => {
	return _.get(
		Object.values(properties).find(prop => prop.GUID === keyId),
		'isActivated',
		true,
	);
};

const getKeys = (keys, jsonSchema) => {
	const newProperties = getSchemaNewProperties(jsonSchema);
	const properties = { ...newProperties, ...jsonSchema.properties };

	return keys.map(key => {
		return {
			name: findName(key.keyId, properties),
			order: key.type === 'descending' ? 'DESC' : 'ASC',
			isActivated: checkIfActivated(key.keyId, properties),
		};
	});
};

const getCompositePrimaryKeys = (jsonSchema, isModifiedPK) => {
	if (!Array.isArray(jsonSchema.primaryKey) && !isModifiedPK) {
		return [];
	}

	const primaryKey = isModifiedPK ? jsonSchema.compMod.primaryKey.new : jsonSchema.primaryKey;

	return primaryKey
		.filter(primaryKey => !_.isEmpty(primaryKey.compositePrimaryKey))
		.map(primaryKey => ({
			...hydratePrimaryKeyOptions(primaryKey),
			columns: getKeys(primaryKey.compositePrimaryKey, jsonSchema),
		}));
};

const getCompositeUniqueKeys = (jsonSchema, isModifiedUK) => {
	if (!Array.isArray(jsonSchema.uniqueKey)) {
		return [];
	}

	const uniqueKey = isModifiedUK ? jsonSchema.compMod.uniqueKey.new : jsonSchema.uniqueKey;

	return uniqueKey
		.filter(uniqueKey => !_.isEmpty(uniqueKey.compositeUniqueKey))
		.map(uniqueKey => ({
			...hydrateUniqueOptions(uniqueKey),
			columns: getKeys(uniqueKey.compositeUniqueKey, jsonSchema),
		}));
};

const getTableKeyConstraints = ({ jsonSchema }) => {
	if (!jsonSchema.properties) {
		return [];
	}

	const uniqueConstraints = mapProperties(jsonSchema, ([name, columnSchema]) => {
		if (!isUnique(columnSchema) || isInlineUnique(columnSchema)) {
			return [];
		} else {
			return columnSchema.uniqueKeyOptions.map(options =>
				hydrateUniqueOptions(options, name, columnSchema.isActivated),
			);
		}
	})
		.flat()
		.filter(Boolean);
	const primaryKeyConstraints = mapProperties(jsonSchema, ([name, columnSchema]) => {
		if (!isPrimaryKey(columnSchema) || isInlinePrimaryKey(columnSchema)) {
			return;
		} else {
			return hydratePrimaryKeyOptions(columnSchema.primaryKeyOptions, name, columnSchema.isActivated);
		}
	}).filter(Boolean);

	return [
		...getCompositePrimaryKeys(jsonSchema),
		...primaryKeyConstraints,
		...getCompositeUniqueKeys(jsonSchema),
		...uniqueConstraints,
	];
};

/**
 * @param {{ jsonSchema: JsonSchema }}
 * @returns {ConstraintDto[]}
 */
const getCompositeKeyConstraints = ({ jsonSchema }) => {
	const compositePrimaryKeys = getCompositePrimaryKeys(jsonSchema);
	const compositeUniqueKeys = getCompositeUniqueKeys(jsonSchema);

	return [...compositePrimaryKeys, ...compositeUniqueKeys];
};

/**
 * @param {{ columnDefinition: ColumnDefinition }}
 * @returns {ConstraintDto | undefined}
 */
const getPrimaryKeyConstraint = ({ columnDefinition }) => {
	if (!isPrimaryKey(columnDefinition)) {
		return;
	}

	return hydratePrimaryKeyOptions(columnDefinition.primaryKeyOptions ?? {}, '', columnDefinition.isActivated);
};

/**
 * @param {{ columnDefinition: ColumnDefinition }}
 * @returns {ConstraintDto[]}
 */
const getUniqueKeyConstraints = ({ columnDefinition }) => {
	if (!isUnique(columnDefinition)) {
		return [];
	}

	if (isInlineUnique(columnDefinition)) {
		const constraint = hydrateUniqueOptions({}, '', columnDefinition.isActivated);

		return [constraint];
	}

	return columnDefinition.uniqueKeyOptions.map(uniqueKeyOption => {
		return hydrateUniqueOptions(uniqueKeyOption, '', columnDefinition.isActivated);
	});
};

/**
 * @param {{ columnDefinition: ColumnDefinition }}
 * @returns {ConstraintDto[]}
 */
const getColumnConstraints = ({ columnDefinition }) => {
	const primaryKeyConstraint = getPrimaryKeyConstraint({ columnDefinition });
	const uniqueKeyConstraints = getUniqueKeyConstraints({ columnDefinition });

	return [primaryKeyConstraint, ...uniqueKeyConstraints].filter(Boolean);
};

/**
 * @param {JsonSchema} jsonSchema
 * @returns {JsonSchema}
 */
const getSchemaNewProperties = jsonSchema => {
	if (!Array.isArray(jsonSchema.compMod?.newProperties)) {
		return {};
	}

	return jsonSchema.compMod.newProperties.reduce((properties, property) => {
		return {
			...properties,
			[property.code || property.name]: {
				...property,
				GUID: property.id,
			},
		};
	}, {});
};

module.exports = {
	getTableKeyConstraints,
	isInlineUnique,
	isInlinePrimaryKey,
	hydratePrimaryKeyOptions,
	hydrateUniqueOptions,
	getCompositeUniqueKeys,
	getCompositePrimaryKeys,
	getCompositeKeyConstraints,
	getColumnConstraints,
};
