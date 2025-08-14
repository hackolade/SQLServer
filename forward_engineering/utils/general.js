'use strict';

module.exports = _ => {
	const sqlFormatter = require('sql-formatter');
	const { RESERVED_WORDS_AS_ARRAY } = require('../enums/reservedWords');

	/**
	 * @typedef {((args: any) => string) | ((args: any) => ChainFunction)} ChainFunction
	 * */

	/**
	 * @return {ChainFunction}
	 * */
	const buildStatement = (mainStatement, isActivated) => {
		let composeStatements = (...statements) => {
			return statements.reduce((result, statement) => result + statement, mainStatement);
		};

		const chain = (...args) => {
			if (args.length) {
				composeStatements = composeStatements.bind(null, getStatement(...args));

				return chain;
			}

			return commentDeactivatedStatements(composeStatements(), isActivated);
		};

		/**
		 * @param condition {boolean}
		 * @param statement {string}
		 * @return {string}
		 * */
		const getStatement = (condition, statement) => {
			if (condition && statement === ')') {
				return '\n)';
			}
			if (statement === ';') {
				return statement;
			}

			if (condition) {
				return '\n' + indentString(statement);
			}

			return '';
		};

		return chain;
	};

	const isEscaped = name => /`[\s\S]*`/.test(name);

	const prepareName = (name = '') => {
		const containSpaces = /[\s-]/g;
		if (containSpaces.test(name) && !isEscaped(name)) {
			return `\`${name}\``;
		} else if (RESERVED_WORDS_AS_ARRAY.includes(name.toUpperCase())) {
			return `\`${name}\``;
		} else if (name === '') {
			return '';
		} else if (!isNaN(name)) {
			return `\`${name}\``;
		}

		return name;
	};
	const replaceSpaceWithUnderscore = (name = '') => {
		return name.replace(/\s/g, '_');
	};

	const getFullTableName = collection => {
		const collectionSchema = { ...collection, ...(_.omit(collection?.role, 'properties') || {}) };
		const tableName = getEntityName(collectionSchema);
		const schemaName = collectionSchema.compMod?.keyspaceName;

		return getNamePrefixedWithSchemaName(tableName, schemaName);
	};

	const getFullCollectionName = collectionSchema => {
		const collectionName = getEntityName(collectionSchema);
		const bucketName = collectionSchema.compMod?.keyspaceName;

		return getNamePrefixedWithSchemaName(collectionName, bucketName);
	};

	const getName = entity => entity.code || entity.collectionName || entity.name || '';

	const getRelationshipName = relationship => relationship.name || '';

	const getTab = (tabNum, configData) => (Array.isArray(configData) ? configData[tabNum] || {} : {});
	const indentString = (str, tab = 4) =>
		(str || '')
			.split('\n')
			.map(s => ' '.repeat(tab) + s)
			.join('\n');

	const descriptors = {};
	const getTypeDescriptor = typeName => {
		if (descriptors[typeName]) {
			return descriptors[typeName];
		}

		try {
			descriptors[typeName] = require(`../../types/${typeName}.json`);

			return descriptors[typeName];
		} catch (e) {
			return {};
		}
	};

	const getNamePrefixedWithSchemaName = (name, schemaName) => {
		if (schemaName) {
			return `${wrapInBrackets(schemaName)}.${wrapInBrackets(name)}`;
		}

		return wrapInBrackets(name);
	};

	/**
	 * @param statement {string}
	 * @param isActivated {boolean}
	 * @return {string}
	 * */
	const commentDeactivatedStatements = (statement, isActivated = true) => {
		if (isActivated) {
			return statement;
		}
		const insertBeforeEachLine = (statement, insertValue) =>
			statement
				.split('\n')
				.map(line => `${insertValue}${line}`)
				.join('\n');

		return insertBeforeEachLine(statement, '-- ');
	};

	const commentDeactivatedInlineKeys = (keys, deactivatedKeyNames) => {
		const [activatedKeys, deactivatedKeys] = _.partition(
			keys,
			key => !(deactivatedKeyNames.has(key) || deactivatedKeyNames.has(key.slice(1, -1))),
		);
		if (activatedKeys.length === 0) {
			return { isAllKeysDeactivated: true, keysString: deactivatedKeys.join(', ') };
		}
		if (deactivatedKeys.length === 0) {
			return { isAllKeysDeactivated: false, keysString: activatedKeys.join(', ') };
		}

		return {
			isAllKeysDeactivated: false,
			keysString: `${activatedKeys.join(', ')} /*, ${deactivatedKeys.join(', ')} */`,
		};
	};

	const wrapInBrackets = name => {
		return `[${name}]`;
	};

	const wrapInBracketsIfNecessary = name => {
		return name.replace(/^(?!\().*?(?<!\))$/, '($&)');
	};

	const escapeSpecialCharacters = (name = '') => {
		return name.replace(/'/g, "''");
	};

	const skipSqlCommentsPattern = /^\s*(EXEC\b|.*\bMS_DESCRIPTION\b)/i;

	const buildScript = statements => {
		const formattedScripts = statements
			.filter(Boolean)
			.map(script =>
				skipSqlCommentsPattern.test(script)
					? script
					: sqlFormatter.format(script, { indent: '    ' }).replace(/\{ \{ (.+?) } }/g, '{{$1}}'),
			);

		return formattedScripts.join('\n\n') + '\n\n';
	};

	const getContainerName = compMod => compMod.keyspaceName;

	const getFullEntityName = (dbName, entityName) => (dbName ? `${dbName}.${entityName}` : entityName);

	const getEntityName = entityData => {
		return (entityData && (entityData.code || entityData.collectionName)) || '';
	};

	/**
	 * @return {Array<any>}
	 * */
	const filterEmptyScripts = (...scripts) => scripts.filter(Boolean);

	const compareProperties =
		_ =>
		({ new: newProperty, old: oldProperty }) => {
			if (!newProperty && !oldProperty) {
				return;
			}

			return !_.isEqual(newProperty, oldProperty);
		};

	const compareObjectsByProperties = (obj1, obj2, properties) => {
		return properties.some(prop => obj1[prop] !== obj2[prop]);
	};

	const getSchemaOfAlterCollection = collection => {
		return { ...collection, ...(_.omit(collection?.role, 'properties') || {}) };
	};

	const buildDefaultPKName = (tableName, columnName) => {
		const PKName = `PK_${tableName}_${columnName}`;

		return wrapInBrackets(PKName);
	};

	return {
		buildStatement,
		getName,
		getTab,
		indentString,
		getTypeDescriptor,
		getRelationshipName,
		prepareName,
		replaceSpaceWithUnderscore,
		commentDeactivatedStatements,
		commentDeactivatedInlineKeys,
		buildScript,
		wrapInBrackets,
		wrapInBracketsIfNecessary,
		escapeSpecialCharacters,
		getFullEntityName,
		getFullTableName,
		getFullCollectionName,
		getContainerName,
		getEntityName,
		filterEmptyScripts,
		getSchemaOfAlterCollection,
		getNamePrefixedWithSchemaName,
		buildDefaultPKName,
		compareObjectsByProperties,
	};
};
