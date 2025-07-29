const { commentIfDeactivated } = require('./commentIfDeactivated');
const types = require('../configs/types');

module.exports = app => {
	const _ = app.require('lodash');
	const generalHasType = app.require('@hackolade/ddl-fe-utils').general.hasType;
	const { decorateDefault } = require('./columnDefinitionHelper')(app);
	const { checkAllKeysDeactivated } = app.require('@hackolade/ddl-fe-utils').general;

	const getTableName = (tableName, schemaName, brackets = true) => {
		const withBrackets = name => (brackets ? `[${name}]` : name);

		if (schemaName) {
			return `${withBrackets(schemaName)}.${withBrackets(tableName)}`;
		}

		return withBrackets(tableName);
	};

	const getDefaultValue = (defaultConstraint, type) => {
		if (_.isUndefined(defaultConstraint.value)) {
			return '';
		}

		const value = decorateDefault(type, defaultConstraint.value);

		if (!_.isUndefined(defaultConstraint.name)) {
			return ` CONSTRAINT ${defaultConstraint.name} DEFAULT ${value}`;
		}

		return ` DEFAULT ${value}`;
	};

	const sanitizeConstraintName = str => {
		return str ? str.replace(/\[|\]/g, '').replace(/\./g, '_') : str;
	};

	const getKeyWithAlias = key => {
		if (!key) {
			return '';
		}

		if (key.alias) {
			return `[${key.name}] as [${key.alias}]`;
		} else {
			return `[${key.name}]`;
		}
	};

	const getSystemVersioning = options => {
		let systemVersioning = 'SYSTEM_VERSIONING=ON';

		if (!options.historyTable) {
			return systemVersioning;
		}

		let historyTable = `HISTORY_TABLE=${options.historyTable}`;

		if (options.dataConsistencyCheck) {
			historyTable += ', DATA_CONSISTENCY_CHECK=ON';
		}

		return `${systemVersioning} (${historyTable})`;
	};

	const getLedger = options => {
		let ledger = 'LEDGER=ON';

		if (!options.ledger_view && !options.append_only) {
			return ledger;
		}

		let optionsStrings = [];

		if (options.ledger_view) {
			optionsStrings.push(`${getLedgerView(options)}`);
		}

		if (options.append_only) {
			optionsStrings.push('APPEND_ONLY=ON');
		}

		return `${ledger} (\n\t\t${optionsStrings.join(',\n\t\t')}\n\t)`;
	};

	const getLedgerView = options => {
		let viewoptions = [];
		if (options.transaction_id_column_name) {
			viewoptions.push(`\n\t\t\tTRANSACTION_ID_COLUMN_NAME=${options.transaction_id_column_name}`);
		}
		if (options.sequence_number_column_name) {
			viewoptions.push(`\n\t\t\tSEQUENCE_NUMBER_COLUMN_NAME=${options.sequence_number_column_name}`);
		}
		if (options.operation_type_id_column_name) {
			viewoptions.push(`\n\t\t\tOPERATION_TYPE_COLUMN_NAME=${options.operation_type_id_column_name}`);
		}
		if (options.operation_type_desc_column_name) {
			viewoptions.push(`\n\t\t\tOPERATION_TYPE_DESC_COLUMN_NAME=${options.operation_type_desc_column_name}`);
		}
		const optionsString = !_.isEmpty(viewoptions) ? ` (${viewoptions.join(',')}\n\t\t)` : '';
		return `LEDGER_VIEW=${options.ledger_view}${optionsString}`;
	};

	const getTableOptions = options => {
		if (!options) {
			return '';
		}

		if (options.memory_optimized) {
			let withOptions = ' WITH (\n\tMEMORY_OPTIMIZED=ON';

			if (options.durability) {
				withOptions += ',\n\tDURABILITY=' + options.durability;
			}

			if (options.systemVersioning) {
				withOptions += ',\n\t' + getSystemVersioning(options);
			}

			return withOptions + '\n)';
		}

		if (!options.temporal) {
			return '';
		}

		let optionsStrings = `WITH (\n\t${getSystemVersioning(options)}`;

		if (options.ledger) {
			optionsStrings += ',\n\t' + getLedger(options);
		}

		return `${optionsStrings}\n)`;
	};

	const hasType = type => {
		return generalHasType(types, type);
	};

	const getViewData = (keys, schemaData) => {
		if (!Array.isArray(keys)) {
			return { tables: [], columns: [] };
		}

		return keys.reduce(
			(result, key) => {
				if (!key.tableName) {
					result.columns.push(getKeyWithAlias(key));

					return result;
				}

				let tableName = getTableName(key.tableName, key.schemaName);

				if (key.dbName && key.dbName !== schemaData.databaseName) {
					tableName = `[${key.dbName}].` + tableName;
				}

				if (!result.tables.includes(tableName)) {
					result.tables.push(tableName);
				}

				result.columns.push({
					statement: `${tableName}.${getKeyWithAlias(key)}`,
					isActivated: key.isActivated,
				});

				return result;
			},
			{
				tables: [],
				columns: [],
			},
		);
	};

	const filterColumnStoreProperties = index => {
		if (index.type !== 'columnstore') {
			return index;
		}
		const unsupportedProperties = [
			'allowRowLocks',
			'allowPageLocks',
			'padIndex',
			'fillFactor',
			'ignoreDuplicateKey',
		];

		return Object.keys(index).reduce((result, property) => {
			if (unsupportedProperties.includes(property)) {
				return result;
			} else {
				return Object.assign({}, result, {
					[property]: index[property],
				});
			}
		}, {});
	};

	const foreignKeysToString = keys => {
		if (Array.isArray(keys)) {
			const activatedKeys = keys
				.filter(key => _.get(key, 'isActivated', true))
				.map(key => `[${key.name.trim()}]`);
			const deactivatedKeys = keys
				.filter(key => !_.get(key, 'isActivated', true))
				.map(key => `[${key.name.trim()}]`);
			const deactivatedKeysAsString = deactivatedKeys.length
				? commentIfDeactivated(deactivatedKeys, { isActivated: false }, true)
				: '';

			return activatedKeys.join(', ') + deactivatedKeysAsString;
		}
		return keys;
	};

	const foreignActiveKeysToString = keys => {
		return keys.map(key => key.name.trim()).join(', ');
	};

	const additionalPropertiesForForeignKey = relationship => {
		const foreignOnDelete = _.get(relationship, 'relationshipOnDelete', '');
		const foreignOnUpdate = _.get(relationship, 'relationshipOnUpdate', '');
		return { foreignOnDelete, foreignOnUpdate };
	};

	const trimBraces = expression =>
		/^\(([\s\S]+?)\)$/i.test(_.trim(expression))
			? _.trim(expression).replace(/^\(([\s\S]+?)\)$/i, '$1')
			: expression;

	const checkIndexActivated = index => {
		if (index.isActivated === false) {
			return false;
		}

		const isAllKeysDeactivated = checkAllKeysDeactivated(_.get(index, 'keys', []));
		const isAllIncludesDeactivated = checkAllKeysDeactivated(_.get(index, 'include', []));
		const isColumnDeactivated = !_.get(index, 'column.isActivated', true);

		return !isAllKeysDeactivated && !isAllIncludesDeactivated && !isColumnDeactivated;
	};

	const getTempTableTime = (isTempTableStartTimeColumn, isTempTableEndTimeColumn, isHidden) => {
		if (isTempTableStartTimeColumn) {
			return ` GENERATED ALWAYS AS ROW START${isHidden ? ' HIDDEN' : ''}`;
		}
		if (isTempTableEndTimeColumn) {
			return ` GENERATED ALWAYS AS ROW END${isHidden ? ' HIDDEN' : ''}`;
		}
		return '';
	};

	/**
	 * @param {Object} params
	 * @param {string} params.primaryTableName
	 * @param {string} params.foreignTableName
	 * @param {Array<AlterRelationshipFKField>} params.primaryTableColumns
	 * @param {Array<AlterRelationshipFKField>} params.foreignTableColumns
	 * @returns {string}
	 */
	const getFKConstraintName = ({ primaryTableName, foreignTableName, primaryTableColumns, foreignTableColumns }) => {
		return sanitizeConstraintName(
			`FK_${[primaryTableName, foreignTableColumns.map(k => k.name).join('_'), foreignTableName, primaryTableColumns.map(k => k.name).join('_')].filter(Boolean).join('_')}`,
		);
	};

	return {
		filterColumnStoreProperties,
		getKeyWithAlias,
		getTableName,
		getTableOptions,
		hasType,
		getViewData,
		foreignKeysToString,
		additionalPropertiesForForeignKey,
		trimBraces,
		sanitizeConstraintName,
		checkIndexActivated,
		foreignActiveKeysToString,
		getDefaultValue,
		getTempTableTime,
		getFKConstraintName,
	};
};
