const _ = require('lodash');
const { getTableName } = require('../general');
const { checkCompModEqual, setIndexKeys, modifyGroupItems } = require('./common');
const { AlterScriptDto } = require('./types/AlterScriptDto');

const alterViewHelper = (app, options) => {
	const { generateIdToNameHashTable, generateIdToActivatedHashTable, mapProperties } =
		app.require('@hackolade/ddl-fe-utils');

	const ddlProvider = require('../../ddlProvider')(null, options, app);

	const getAddViewScriptDto = view => {
		const viewName = getTableName(view.code || view.name, view?.role?.compMod?.keyspaceName);
		const viewSchema = { ...view, ...view.role };
		const idToNameHashTable = generateRefToNameHashTable(viewSchema);
		const idToActivatedHashTable = generateRefToActivatedHashTable(viewSchema);
		const schemaData = { schemaName: viewSchema.compMod.keyspaceName };

		const viewData = {
			name: viewSchema.code || viewSchema.name,
			keys: getKeys(viewSchema, viewSchema.compMod?.collectionData?.collectionRefsDefinitionsMap ?? {}),
			schemaData,
		};
		const hydratedView = ddlProvider.hydrateView({ viewData, entityData: [view] });

		const viewScript = AlterScriptDto.getInstance(
			[ddlProvider.createView(hydratedView, {}, view.isActivated)],
			true,
			false,
		);
		const indexesSCripts = (viewSchema.Indxs || [])
			.map(hydrateIndex({ idToNameHashTable, idToActivatedHashTable, schemaData }))
			.map(index => AlterScriptDto.getInstance([ddlProvider.createViewIndex(viewName, index)], true, false));

		return [viewScript, ...indexesSCripts].filter(Boolean);
	};

	const getDeleteViewScriptDto = view => {
		const viewName = getTableName(view.code || view.name, view?.role?.compMod?.keyspaceName);

		return AlterScriptDto.getInstance([ddlProvider.dropView(viewName)], true, true);
	};

	const getModifiedViewScriptDto = view => {
		const viewSchema = { ...view, ...view.role };
		const idToNameHashTable = generateIdToNameHashTable(viewSchema);
		const idToActivatedHashTable = generateIdToActivatedHashTable(viewSchema);
		const schemaData = { schemaName: viewSchema.compMod.keyspaceName };
		const viewData = {
			name: viewSchema.code || viewSchema.name,
			keys: getKeys(viewSchema, viewSchema.compMod?.collectionData?.collectionRefsDefinitionsMap ?? {}),
			schemaData,
		};

		const isViewAttributeModified = !checkCompModEqual(viewSchema.compMod?.viewAttrbute);
		const isSelectStatementModified = !checkCompModEqual(viewSchema.compMod?.selectStatement);
		const isCheckOptionModified = !checkCompModEqual(viewSchema.compMod?.withCheckOption);
		const isFieldsModifiedWithNoSelectStatement =
			!_.trim(viewSchema.selectStatement) && !_.isEmpty(view.properties);

		let alterView = AlterScriptDto.getInstance([], true, false);

		if (
			isViewAttributeModified ||
			isSelectStatementModified ||
			isCheckOptionModified ||
			isFieldsModifiedWithNoSelectStatement
		) {
			const hydratedView = ddlProvider.hydrateView({ viewData, entityData: [viewSchema] });
			alterView = AlterScriptDto.getInstance(
				[ddlProvider.alterView(hydratedView, null, viewSchema.isActivated)],
				true,
				false,
			);
		}

		const alterIndexesScripts = modifyGroupItems({
			data: viewSchema,
			key: 'Indxs',
			hydrate: hydrateIndex({ idToNameHashTable, idToActivatedHashTable, schemaData }),
			create: (viewName, index) =>
				index.orReplace
					? [
							AlterScriptDto.getInstance([ddlProvider.dropIndex(viewName, index)], true, true),
							AlterScriptDto.getInstance([ddlProvider.createViewIndex(viewName, index)], true, true),
						]
					: AlterScriptDto.getInstance([ddlProvider.createViewIndex(viewName, index)], true, false),
			drop: (viewName, index) => AlterScriptDto.getInstance([ddlProvider.dropIndex(viewName, index)], true, true),
		}).flat();

		return [alterView, ...alterIndexesScripts];
	};

	const getKeys = (viewSchema, collectionRefsDefinitionsMap) => {
		return mapProperties(viewSchema, (propertyName, schema) => {
			const definition = collectionRefsDefinitionsMap[schema.refId];

			if (!definition) {
				return ddlProvider.hydrateViewColumn({
					name: propertyName,
					isActivated: schema.isActivated,
				});
			}

			const entityName =
				_.get(definition.collection, '[0].code', '') ||
				_.get(definition.collection, '[0].collectionName', '') ||
				'';
			const dbName = _.get(definition.bucket, '[0].code') || _.get(definition.bucket, '[0].name', '');
			const name = definition.name;

			if (name === propertyName) {
				return ddlProvider.hydrateViewColumn({
					containerData: definition.bucket,
					entityData: definition.collection,
					isActivated: schema.isActivated,
					definition: definition.definition,
					entityName,
					name,
					dbName,
				});
			}

			return ddlProvider.hydrateViewColumn({
				containerData: definition.bucket,
				entityData: definition.collection,
				isActivated: schema.isActivated,
				definition: definition.definition,
				alias: propertyName,
				entityName,
				name,
				dbName,
			});
		});
	};

	const hydrateIndex =
		({ idToNameHashTable, idToActivatedHashTable, schemaData }) =>
		index => {
			index = setIndexKeys(idToNameHashTable, idToActivatedHashTable, index);

			return ddlProvider.hydrateViewIndex(index, schemaData);
		};

	const getViewUpdateCommentScript = ({ schemaName, viewName, comment }) =>
		ddlProvider.updateViewComment({ schemaName, viewName, comment });
	const getViewDropCommentScript = ({ schemaName, viewName }) =>
		ddlProvider.dropViewComment({
			schemaName,
			viewName,
		});

	const getViewsDropCommentAlterScriptsDto = views => {
		return Object.keys(views)
			.map(viewName => {
				const view = views[viewName];

				if (!view?.role?.description) {
					return undefined;
				}

				const schemaName = view.role?.compMod?.bucketProperties?.name;
				const script = getViewDropCommentScript({ schemaName, viewName });

				return AlterScriptDto.getInstance([script], true, true);
			})
			.filter(Boolean);
	};

	const getViewsModifyCommentsAlterScriptsDto = views => {
		return Object.keys(views)
			.map(viewName => {
				let script = '';
				const viewComparison = views[viewName].role?.compMod;
				const schemaName = viewComparison.keyspaceName;
				const newComment = viewComparison?.description?.new;
				const oldComment = viewComparison?.description?.old;
				const isCommentRemoved = oldComment && !newComment;

				if (isCommentRemoved) {
					script = getViewDropCommentScript({ schemaName, viewName });

					return AlterScriptDto.getInstance([script], true, true);
				}

				if (!newComment || newComment === oldComment) {
					return undefined;
				}

				if (oldComment) {
					script = getViewUpdateCommentScript({ schemaName, viewName, comment: newComment });
				} else {
					script = ddlProvider.createViewComment({
						schemaName,
						viewName,
						comment: newComment,
					});
				}

				return AlterScriptDto.getInstance([script], true, false);
			})
			.filter(Boolean);
	};

	const getViewColumnCreateCommentScript = ({ schemaName, viewName, columnName, comment }) =>
		ddlProvider.createViewColumnComment({ schemaName, viewName, columnName, comment });
	const getViewColumnUpdateCommentScript = ({ schemaName, viewName, columnName, comment }) =>
		ddlProvider.updateViewColumnComment({ schemaName, viewName, columnName, comment });
	const getViewColumnDropCommentScript = ({ schemaName, viewName, columnName }) =>
		ddlProvider.dropViewColumnComment({ schemaName, viewName, columnName });

	const getViewColumnsCreateCommentAlterScriptsDto = views => {
		return Object.keys(views)
			.flatMap(viewName => {
				const columns = views[viewName].properties;
				if (!columns) {
					return [];
				}
				const schemaName = views[viewName].role?.compMod.keyspaceName;
				return Object.keys(columns).map(columnName => {
					const column = columns[columnName];
					const isColumnRenamed = column?.compMod?.oldField?.name !== column?.compMod?.newField?.name;
					const columnNameToSearchComment = isColumnRenamed ? column?.compMod?.oldField?.name : columnName;
					const comment = column.refDescription;
					const oldComment = views[viewName].role?.properties[columnNameToSearchComment]?.refDescription;

					if (!comment || oldComment) {
						return undefined;
					}

					const script = getViewColumnCreateCommentScript({ schemaName, viewName, columnName, comment });

					return AlterScriptDto.getInstance([script], true, false);
				});
			})
			.filter(Boolean);
	};

	const getViewColumnsDropCommentAlterScriptsDto = views => {
		return Object.keys(views)
			.flatMap(viewName => {
				const columns = views[viewName].properties;
				if (!columns) {
					return [];
				}
				const schemaName = views[viewName].role?.compMod.keyspaceName;
				return Object.keys(columns)
					.filter(columnName => Boolean(columns[columnName].refDescription))
					.map(columnName => {
						const script = getViewColumnDropCommentScript({ schemaName, viewName, columnName });

						return AlterScriptDto.getInstance([script], true, true);
					});
			})
			.filter(Boolean);
	};

	const getViewColumnsModifyCommentAlterScriptsDto = views => {
		return Object.keys(views)
			.flatMap(viewName => {
				const columns = views[viewName].properties;
				if (!columns) {
					return undefined;
				}
				const schemaName = views[viewName].role?.compMod.keyspaceName;
				return Object.keys(columns).map(columnName => {
					let script = '';
					const newComment = columns[columnName]?.refDescription;
					const oldComment = views[viewName].role?.properties[columnName]?.refDescription;
					const isCommentRemoved = oldComment && !newComment;

					if (isCommentRemoved) {
						script = getViewColumnDropCommentScript({ schemaName, viewName, columnName });

						return AlterScriptDto.getInstance([script], true, true);
					}

					if (!newComment || !oldComment || newComment === oldComment) {
						return undefined;
					}

					if (oldComment) {
						script = getViewColumnUpdateCommentScript({
							schemaName,
							viewName,
							columnName,
							comment: newComment,
						});
					} else {
						script = getViewColumnCreateCommentScript({
							schemaName,
							viewName,
							columnName,
							comment: newComment,
						});
					}

					return AlterScriptDto.getInstance([script], true, false);
				});
			})
			.filter(Boolean);
	};

	const generateRefToNameHashTable = view => {
		const refToNameHashTable = {};

		mapProperties(view, (propertyName, schema) => {
			refToNameHashTable[schema.ref] = propertyName;
		});

		return refToNameHashTable;
	};

	const generateRefToActivatedHashTable = view => {
		const refToActivatedHashTable = {};

		mapProperties(view, (propertyName, schema) => {
			refToActivatedHashTable[schema.ref] = schema.isActivated;
		});

		return refToActivatedHashTable;
	};

	return {
		getAddViewScriptDto,
		getDeleteViewScriptDto,
		getModifiedViewScriptDto,
		getViewsDropCommentAlterScriptsDto,
		getViewsModifyCommentsAlterScriptsDto,
		getViewColumnsCreateCommentAlterScriptsDto,
		getViewColumnsDropCommentAlterScriptsDto,
		getViewColumnsModifyCommentAlterScriptsDto,
	};
};

module.exports = alterViewHelper;
