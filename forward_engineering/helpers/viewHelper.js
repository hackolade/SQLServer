const _ = require('lodash');
const { commentIfDeactivated } = require('./commentIfDeactivated');
const templates = require('../configs/templates');
const { divideIntoActivatedAndDeactivated, tab } = require('../utils/general');
const { assignTemplates } = require('../utils/assignTemplates');
const { getViewData, getTableName } = require('./general');

const createViewSelectStatement = ({ terminator, keys, tables, selectStatement, isParentActivated }) => {
	const mapKeys = key => (key.alias ? `[${key.name}] AS [${key.alias}]` : `[${key.name}]`);
	let selectKeys = keys.map(mapKeys).join(',');

	if (isParentActivated) {
		const dividedKeys = divideIntoActivatedAndDeactivated(keys, mapKeys);
		const activatedKeys = dividedKeys.activatedItems.join(',');
		const deactivatedKeys = dividedKeys.deactivatedItems.length
			? commentIfDeactivated(dividedKeys.deactivatedItems.join(','), { isActivated: false }, true)
			: '';
		selectKeys = activatedKeys + deactivatedKeys || '*';
	}

	return tables
		.map(table => {
			return selectStatement
				? assignTemplates(selectStatement, { tableName: getFullTableName(table), terminator })
				: `SELECT ${selectKeys}\nFROM ${getFullTableName(table)}`;
		})
		.join('\nUNION ALL\n');
};

const getFullTableName = table => {
	let name = `[${table.name}]`;

	if (table.schemaName) {
		name = `[${table.schemaName}].` + name;
	}

	if (table.databaseName) {
		name = `[${table.databaseName}].` + name;
	}

	return name;
};

const getPartitionedTables = (partitionedTables, relatedSchemas = {}, relatedContainers = {}) => {
	const schemaIds = partitionedTables.map(item => item.table);

	return schemaIds
		.map(id => relatedSchemas[id])
		.filter(Boolean)
		.map(schema => {
			let schemaName = '';
			let databaseName = '';

			if (relatedContainers[schema.bucketId]) {
				const db = _.first(relatedContainers[schema.bucketId]) || {};
				schemaName = db.code || db.name || '';
				databaseName = db.databaseName || '';
			}

			return {
				name: schema.code || schema.collectionName,
				databaseName,
				schemaName,
			};
		});
};

const getCreateViewData = ({
	name,
	keys,
	partitionedTables,
	partitioned,
	viewAttrbute: viewAttribute,
	withCheckOption,
	selectStatement,
	schemaData,
	ifNotExist,
	terminator,
	isActivated,
}) => {
	const viewTerminator = ifNotExist ? ';' : terminator;
	const viewData = getViewData(keys, schemaData);

	if (partitioned) {
		selectStatement = createViewSelectStatement({
			tables: partitionedTables,
			selectStatement,
			keys,
			terminator: viewTerminator,
			isParentActivated: isActivated,
		});
	}

	if ((_.isEmpty(viewData.tables) || _.isEmpty(viewData.columns)) && !selectStatement) {
		return null;
	}

	let columnsAsString = viewData.columns.map(column => column.statement).join(',\n\t\t');

	if (isActivated) {
		const dividedColumns = divideIntoActivatedAndDeactivated(viewData.columns, column => column.statement);
		const deactivatedColumnsString = dividedColumns.deactivatedItems.length
			? commentIfDeactivated(dividedColumns.deactivatedItems.join(',\n\t\t'), { isActivated: false }, true)
			: '';
		columnsAsString = dividedColumns.activatedItems.join(',\n\t\t') + deactivatedColumnsString;
	}

	const viewName = getTableName(name, schemaData.schemaName);
	const viewNameIfNotExist = getTableName(name, schemaData.schemaName, false);

	return {
		viewName,
		viewNameIfNotExist,
		viewAttribute: viewAttribute ? `WITH ${viewAttribute}\n` : '',
		checkOption: withCheckOption ? `WITH CHECK OPTION` : '',
		selectStatement: _.trim(selectStatement)
			? _.trim(tab(selectStatement)) + '\n'
			: assignTemplates(templates.viewSelectStatement, {
					tableName: viewData.tables.join(', '),
					keys: columnsAsString,
					terminator: viewTerminator,
				}),
		terminator: viewTerminator,
	};
};

module.exports = {
	createViewSelectStatement,
	getPartitionedTables,
	getCreateViewData,
};
