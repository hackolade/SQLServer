const _ = require('lodash');
const templates = require('../configs/templates');
const { assignTemplates } = require('../utils/assignTemplates');
const { wrapInBrackets, escapeSpecialCharacters } = require('../utils/general');

const addLength = (type, length) => {
	return `${type}(${length})`;
};

const addMaxLength = type => {
	return `${type}(MAX)`;
};

const addScalePrecision = (type, precision, scale) => {
	if (_.isNumber(scale)) {
		return `${type}(${precision},${scale})`;
	}

	return `${type}(${precision})`;
};

const addPrecision = (type, precision) => {
	return `${type}(${precision})`;
};

const addXmlProperties = (type, constraint, schemaCollection) => {
	if (!schemaCollection) {
		return type;
	}

	if (constraint) {
		return `${type}(${constraint} ${schemaCollection})`;
	}

	return `${type}(${schemaCollection})`;
};

const canHaveLength = type => ['CHAR', 'NCHAR', 'VARCHAR', 'NVARCHAR', 'BINARY', 'VARBINARY'].includes(type);

const canHaveMax = type => ['VARCHAR', 'NVARCHAR', 'VARBINARY'].includes(type);

const canHavePrecision = type => ['DECIMAL', 'NUMERIC', 'DATETIME2', 'DATETIMEOFFSET', 'TIME'].includes(type);

const canHaveScale = type => ['DECIMAL', 'NUMERIC'].includes(type);

const decorateType = (type, columnDefinition) => {
	if (canHaveMax(type) && columnDefinition.hasMaxLength) {
		return addMaxLength(type);
	} else if (canHaveLength(type) && _.isNumber(columnDefinition.length)) {
		return addLength(type, columnDefinition.length);
	} else if (canHavePrecision(type) && canHaveScale(type) && _.isNumber(columnDefinition.precision)) {
		return addScalePrecision(type, columnDefinition.precision, columnDefinition.scale);
	} else if (canHavePrecision(type) && _.isNumber(columnDefinition.precision)) {
		return addPrecision(type, columnDefinition.precision);
	} else if (type === 'XML') {
		return addXmlProperties(type, columnDefinition.xmlConstraint, columnDefinition.xmlSchemaCollection);
	}

	return type;
};

const isString = type => ['CHAR', 'VARCHAR', 'NCHAR', 'NVARCHAR', 'TEXT', 'NTEXT'].includes(_.toUpper(type));

/**
 * Escape only inner single quotes.
 * @param {string} str
 * @returns {string}
 */
const escapeQuotes = str => _.trim(str).replace(/(\')+/g, "'$1");

const decorateDefault = (type, defaultValue) => {
	if (type === 'XML') {
		return `CAST(N'${defaultValue}' AS xml)`;
	}

	return defaultValue;
};

const getIdentity = identity => {
	if (!identity.seed || !identity.increment) {
		return '';
	}

	return ` IDENTITY(${identity.seed}, ${identity.increment})`;
};

const addClustered = (statement, columnDefinition) => {
	if (!columnDefinition.primaryKey && !columnDefinition.unique) {
		return '';
	}

	if (!columnDefinition.clustered) {
		return statement + ' NONCLUSTERED';
	}

	return statement + ' CLUSTERED';
};

const getEncryptedWith = encryption => {
	return (
		' ENCRYPTED WITH (\n' +
		'\t\tCOLUMN_ENCRYPTION_KEY=' +
		encryption.key +
		',\n' +
		'\t\tENCRYPTION_TYPE=' +
		encryption.type +
		',\n' +
		"\t\tALGORITHM='" +
		encryption.algorithm +
		"'\n" +
		'\t)'
	);
};

const getColumnsComments = (tableName, terminator, columnDefinitions) => {
	return columnDefinitions
		.filter(({ comment }) => Boolean(comment))
		.map(({ comment, schemaName, name }) => {
			if (!schemaName || !tableName) {
				return '';
			}

			return assignTemplates(templates.createColumnComment, {
				value: escapeSpecialCharacters(comment),
				schemaName: wrapInBrackets(schemaName),
				tableName: wrapInBrackets(tableName),
				columnName: wrapInBrackets(name),
				terminator,
			});
		})
		.join('\n');
};

/**
 *
 * @param {string} type
 * @returns {boolean}
 */
const canHaveIdentity = type => {
	const typesAllowedToHaveAutoIncrement = ['tinyint', 'smallint', 'int', 'bigint'];
	return typesAllowedToHaveAutoIncrement.includes(type);
};

module.exports = {
	decorateType,
	decorateDefault,
	getIdentity,
	getEncryptedWith,
	addClustered,
	getColumnsComments,
	canHaveIdentity,
};
