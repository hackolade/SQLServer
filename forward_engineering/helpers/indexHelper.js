const _ = require('lodash');
const templates = require('../configs/templates');
const { commentIfDeactivated } = require('./commentIfDeactivated');
const { filterColumnStoreProperties, getTableName } = require('./general');
const { assignTemplates } = require('../utils/assignTemplates');
const { divideIntoActivatedAndDeactivated, checkAllKeysDeactivated } = require('../utils/general');

const BOUNDING_BOX_LABEL = ['XMIN', 'YMIN', 'XMAX', 'YMAX'];

const trimBraces = expression =>
	/^\(([\s\S]+?)\)$/i.test(_.trim(expression)) ? _.trim(expression).replace(/^\(([\s\S]+?)\)$/i, '$1') : expression;

const getRelationOptionsIndex = index => {
	let result = [];

	if (index.padIndex) {
		result.push('PAD_INDEX = ON');
	}

	if (index.fillFactor) {
		result.push('FILLFACTOR = ' + index.fillFactor);
	}

	if (index.ignoreDuplicateKey) {
		result.push('IGNORE_DUP_KEY = ON');
	}

	if (index.statisticsNoRecompute) {
		result.push('STATISTICS_NORECOMPUTE = ON');
	}

	if (index.statisticsIncremental) {
		result.push('STATISTICS_INCREMENTAL = ON');
	}

	if (index.allowRowLocks === false) {
		result.push('ALLOW_ROW_LOCKS = OFF');
	}

	if (index.allowPageLocks === false) {
		result.push('ALLOW_PAGE_LOCKS = OFF');
	}

	if (index.optimizeForSequentialKey) {
		result.push('OPTIMIZE_FOR_SEQUENTIAL_KEY = ON');
	}

	if (index.type === 'columnstore' && index.compressionDelay) {
		result.push('COMPRESSION_DELAY = ' + index.compressionDelay);
	}

	if (index.dataCompression && index.dataCompression !== 'NONE') {
		result.push('DATA_COMPRESSION = ' + index.dataCompression);
	}

	return result;
};

const createIndex = (terminator, tableName, index, isParentActivated = true) => {
	const isInvalidColumnStore = index.type !== 'columnstore' || (index.type === 'columnstore' && !index.clustered);

	if ((_.isEmpty(index.keys) && isInvalidColumnStore) || !index.name) {
		return '';
	}

	const include =
		Array.isArray(index.include) && !_.isEmpty(index.include)
			? `\n\tINCLUDE (${_.concat(index.include, index.includedColumn).map(key =>
					isParentActivated ? commentIfDeactivated(`[${key.name}]`, key, true) : `[${key.name}]`,
				)})`
			: '';
	const relationalIndexOption = getRelationOptionsIndex(index);

	const dividedKeys = divideIntoActivatedAndDeactivated(
		index.keys,
		key => `[${key.name}]` + (_.toLower(key.type) === 'descending' ? ' DESC' : ''),
	);
	const commentedKeys = dividedKeys.deactivatedItems.length
		? commentIfDeactivated(dividedKeys.deactivatedItems.join(', '), { isActivated: false }, true)
		: '';

	const activatedKeys = dividedKeys.activatedItems.join(', ');
	const deactivatedKeys = dividedKeys.deactivatedItems.join(', ');

	let keys = activatedKeys + commentedKeys;

	if (!isParentActivated) {
		keys = activatedKeys + (activatedKeys && deactivatedKeys ? ', ' : '') + deactivatedKeys;
	}

	return assignTemplates(templates.index, {
		name: index.name,
		unique: index.unique ? ' UNIQUE' : '',
		clustered: index.clustered ? ' CLUSTERED' : '',
		table: getTableName(tableName, index.schemaName),
		keys: dividedKeys.activatedItems.length || commentedKeys.length ? ` ( ${keys} )` : '',
		columnstore: index.type === 'columnstore' ? ' COLUMNSTORE' : '',
		relational_index_option: relationalIndexOption.length
			? '\n\tWITH (\n\t\t' + relationalIndexOption.join(',\n\t\t') + '\n\t)'
			: '',
		include,
		expression: index.filterExpression ? `\n\tWHERE ${trimBraces(index.filterExpression)}\n` : '',
		terminator,
	});
};

const getFulltextCatalog = ({ catalogName, fileGroup }) => {
	if (catalogName && fileGroup) {
		return `(${catalogName}, FILEGROUP ${fileGroup})`;
	} else if (catalogName) {
		return catalogName;
	} else if (fileGroup) {
		return `(FILEGROUP ${fileGroup})`;
	} else {
		return '';
	}
};

const getFullTextOptions = ({ changeTracking, stopList, searchPropertyList }) => {
	let options = [];

	if (changeTracking) {
		options.push(`CHANGE_TRACKING=${changeTracking}`);
	}

	if (stopList) {
		options.push(`STOPLIST=${stopList}`);
	}

	if (searchPropertyList) {
		options.push(`SEARCH PROPERTY LIST=${searchPropertyList}`);
	}

	return options.join(',\n\t');
};

const createFullTextIndex = (terminator, tableName, index, isParentActivated) => {
	if (!index.keyIndex) {
		return '';
	}
	const catalog = getFulltextCatalog(index);
	const options = getFullTextOptions(index);

	const keys = index.keys
		.map(key => {
			let column = `[${key.name}]`;

			if (key.columnType) {
				column += ` TYPE COLUMN ${key.columnType}`;
			}

			if (key.languageTerm) {
				column += ` LANGUAGE ${key.languageTerm}`;
			}

			if (key.statisticalSemantics) {
				column += ` STATISTICAL_SEMANTICS`;
			}

			return isParentActivated ? commentIfDeactivated(column, key) : column;
		})
		.join(',\n\t');

	return assignTemplates(templates.fullTextIndex, {
		table: getTableName(tableName, index.schemaName),
		keys: keys ? ` (\n\t${keys}\n)` : '',
		indexName: index.keyIndex,
		catalog: catalog ? `ON ${catalog}\n` : '',
		options: options ? `WITH (\n\t${options}\n)` : '',
		terminator,
	});
};

const getSpatialOptions = indexData => {
	const general = getRelationOptionsIndex(indexData);
	const createBoundingGrids = (keys, data = {}) =>
		keys
			.filter(key => Boolean(data[key]) || data[key] === 0)
			.map(key => `${key} = ${data[key]}`)
			.join(', ');

	if (indexData.cellsPerObject) {
		general.unshift(`CELLS_PER_OBJECT = ${indexData.cellsPerObject}`);
	}

	if (indexData.sortInTempdb) {
		general.unshift(`SORT_IN_TEMPDB = ON`);
	}

	if (indexData.dropExisting) {
		general.unshift(`DROP_EXISTING = ON`);
	}

	if (indexData.maxdop) {
		general.unshift(`MAXDOP = ${indexData.maxdop}`);
	}

	if (!_.isEmpty(indexData.boundingBox)) {
		general.unshift(`BOUNDING_BOX = (\n\t\t${createBoundingGrids(BOUNDING_BOX_LABEL, indexData.boundingBox)}\n\t)`);
	}

	if (!_.isEmpty(indexData.grids)) {
		general.unshift(
			`GRIDS = (\n\t\t${createBoundingGrids(['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4'], indexData.grids)}\n\t)`,
		);
	}

	return general;
};

const createSpatialIndex = (terminator, tableName, index) => {
	if (!index.column || !index.name) {
		return '';
	}
	const options = getSpatialOptions(index);

	return assignTemplates(templates.spatialIndex, {
		name: index.name,
		table: getTableName(tableName, index.schemaName),
		column: `[${index.column.name}]`,
		using: index.using ? `\nUSING ${index.using}` : '',
		options: options.length ? 'WITH (\n\t' + options.join(',\n\t') + '\n)' : '',
		terminator,
	});
};

const createTableIndex = (terminator, tableName, index, isParentActivated) => {
	if (index.type === 'spatial') {
		return createSpatialIndex(terminator, tableName, index);
	} else if (index.type === 'fulltext') {
		return createFullTextIndex(terminator, tableName, index);
	}

	return createIndex(terminator, tableName, index, isParentActivated);
};

const createMemoryOptimizedClusteredIndex = indexData => {
	let index = 'CLUSTERED COLUMNSTORE';

	if (indexData.compressionDelay) {
		index += ` WITH (COMPRESSION_DELAY = ${indexData.compressionDelay})`;
	}

	if (indexData.fileGroupName) {
		index += ` ON ${indexData.fileGroupName}`;
	}

	return index;
};

const createMemoryOptimizedIndex = isParentActivated => indexData => {
	let index = `INDEX ${indexData.name}`;

	if (indexData.clustered) {
		return { statement: index + ' ' + createMemoryOptimizedClusteredIndex(indexData), isActivated: true };
	}

	const isAllKeysDeactivated = checkAllKeysDeactivated(indexData.keys);

	index += ' NONCLUSTERED';

	if (indexData.unique) {
		index += ' UNIQUE';
	}

	if (indexData.hash) {
		const keys = divideIntoActivatedAndDeactivated(indexData.keys, key => `[${key.name}]`);
		const activatedKeys = keys.activatedItems.join(', ');
		const deactivatedKeys = keys.deactivatedItems.length
			? commentIfDeactivated(
					keys.deactivatedItems.join(', '),
					{
						isActivated: !isParentActivated,
					},
					true,
				)
			: '';
		index += ` HASH (${activatedKeys}${
			activatedKeys.length && deactivatedKeys.length && !deactivatedKeys.startsWith('/*') ? ', ' : ''
		}${deactivatedKeys})`;

		if (indexData.bucketCount) {
			index += ` WITH (BUCKET_COUNT=${indexData.bucketCount})`;
		}
	} else {
		const keys = divideIntoActivatedAndDeactivated(
			indexData.keys,
			key => `[${key.name}]${_.toLower(key.type) === 'descending' ? ' DESC' : ''}`,
		);
		const activatedKeys = keys.activatedItems.join(', ');
		const deactivatedKeys = keys.deactivatedItems.length
			? commentIfDeactivated(
					keys.deactivatedItems.join(', '),
					{
						isActivated: !isParentActivated,
					},
					true,
				)
			: '';

		index += ` (${activatedKeys}${
			activatedKeys.length && deactivatedKeys.length && !deactivatedKeys.startsWith('/*') ? ', ' : ''
		}${deactivatedKeys})`;

		if (indexData.fileGroupName) {
			index += ` ON ${indexData.fileGroupName}`;
		}
	}

	return { statement: index, isActivated: !isAllKeysDeactivated };
};

const hydrateIndex = (indexData, schemaData) => {
	const toArray = value => (Array.isArray(value) ? value : []);

	return filterColumnStoreProperties({
		name: indexData.indxName,
		isActivated: indexData.isActivated,
		type: _.toLower(indexData.indxType),
		unique: indexData.uniqueIndx,
		clustered: indexData.clusteredIndx,
		keys: toArray(indexData.indxKey),
		include: toArray(indexData.indxInclude),
		filterExpression: indexData.indxFilterExpression,
		padIndex: indexData.PAD_INDEX,
		fillFactor: indexData.FILLFACTOR,
		ignoreDuplicateKey: indexData.IGNORE_DUP_KEY,
		includedColumn: toArray(indexData.indxIncludedColumn),
		statisticsNoRecompute: indexData.STATISTICS_NORECOMPUTE,
		statisticsIncremental: indexData.STATISTICS_INCREMENTAL,
		allowRowLocks: indexData.ALLOW_ROW_LOCKS,
		allowPageLocks: indexData.ALLOW_PAGE_LOCKS,
		optimizeForSequentialKey: indexData.OPTIMIZE_FOR_SEQUENTIAL_KEY,
		compressionDelay: indexData.COMPRESSION_DELAY,
		dataCompression: indexData.DATA_COMPRESSION,
		schemaName: schemaData.schemaName,
	});
};

const hydrateMemoryOptimizedIndex = schemaData => indexData => {
	let index = hydrateIndex(indexData, schemaData);

	return {
		name: index.name,
		isActivated: index.isActivated,
		clustered: index.clustered,
		hash: indexData.indxHash,
		unique: index.unique,
		keys: index.keys,
		bucketCount: Number.isNaN(indexData.indxBucketCount) ? -1 : indexData.indxBucketCount,
		fileGroupName: indexData.indxFileGroupName,
		compressionDelay: index.compressionDelay,
	};
};

const hydrateFullTextIndex = (indexData, schemaData) => {
	const generalIndex = hydrateIndex(indexData, schemaData);

	return {
		type: 'fulltext',
		isActivated: indexData.isActivated,
		keys: Array.isArray(indexData.indxFullTextKeysProperties)
			? generalIndex.keys.map((item, i) => {
					const properties = indexData.indxFullTextKeysProperties[i];

					if (properties) {
						return {
							...item,
							columnType: properties.columnType,
							languageTerm: properties.languageTerm,
							statisticalSemantics: properties.statisticalSemantics,
						};
					} else {
						return item;
					}
				})
			: generalIndex.keys,
		keyIndex: indexData.indxFullTextKeyIndex,
		catalogName: indexData.indxFullTextCatalogName,
		fileGroup: indexData.indxFullTextFileGroup,
		changeTracking:
			indexData.indxFullTextChangeTracking === 'OFF' && indexData.indxFullTextNoPopulation
				? 'OFF, NO POPULATION'
				: indexData.indxFullTextChangeTracking,
		stopList:
			indexData.indxFullTextStopList === 'Stoplist name'
				? indexData.indxFullTextStopListName
				: indexData.indxFullTextStopList,
		searchPropertyList: indexData.indxFullTextSearchPropertyList,
		schemaName: schemaData.schemaName,
	};
};

const hydrateSpatialIndex = (indexData, schemaData) => {
	const generalIndex = hydrateIndex(indexData, schemaData);
	const isAllBoundingBoxValue = data =>
		BOUNDING_BOX_LABEL.every(bounding => Boolean(data?.[bounding]) || data?.[bounding] === 0);

	return {
		..._.pick(generalIndex, [
			'name',
			'type',
			'padIndex',
			'fillFactor',
			'ignoreDuplicateKey',
			'statisticsNoRecompute',
			'allowRowLocks',
			'allowPageLocks',
			'dataCompression',
			'isActivated',
		]),
		column: generalIndex.keys[0],
		using: indexData.indxUsing,
		boundingBox:
			isAllBoundingBoxValue(indexData.indxBoundingBox) &&
			['GEOMETRY_AUTO_GRID', 'GEOMETRY_GRID'].includes(indexData.indxUsing)
				? indexData.indxBoundingBox
				: {},
		grids:
			!_.isEmpty(indexData.indxGrids) && ['GEOMETRY_GRID', 'GEOGRAPHY_GRID'].includes(indexData.indxUsing)
				? indexData.indxGrids
				: [],
		cellsPerObject: indexData.CELLS_PER_OBJECT,
		sortInTempdb: indexData.SORT_IN_TEMPDB,
		dropExisting: indexData.DROP_EXISTING,
		maxdop: indexData.MAXDOP,
		schemaName: schemaData.schemaName,
	};
};

const hydrateTableIndex = (indexData, schemaData) => {
	if (indexData.indxType === 'Spatial') {
		return hydrateSpatialIndex(indexData, schemaData);
	} else if (indexData.indxType === 'FullText') {
		return hydrateFullTextIndex(indexData, schemaData);
	} else {
		return hydrateIndex(indexData, schemaData);
	}
};

const getMemoryOptimizedIndexes = (tableData, schemaData) => {
	const indexTab = tableData.find(tab => _.has(tab, 'Indxs'));

	if (!indexTab) {
		return [];
	}

	return indexTab.Indxs.map(hydrateMemoryOptimizedIndex(schemaData));
};

module.exports = {
	getRelationOptionsIndex,
	createIndex,
	hydrateIndex,
	hydrateMemoryOptimizedIndex,
	createMemoryOptimizedIndex,
	hydrateTableIndex,
	createTableIndex,
	getMemoryOptimizedIndexes,
};
