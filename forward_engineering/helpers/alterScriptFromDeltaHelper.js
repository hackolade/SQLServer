'use strict';

module.exports = _ => {
	const { buildScript, commentDeactivatedStatements } = require('../utils/general')(_);

	/**
	 * @typedef {import('./alterScriptHelpers/types/AlterScriptDto').AlterScriptDto} AlterScriptDto
	 * */

	/**
	 * @param scripts {Array<string>}
	 * @return {Array<string>}
	 * */
	const assertNoEmptyStatements = scripts => {
		return scripts
			.filter(Boolean)
			.map(script => {
				return script.trim();
			})
			.filter(Boolean);
	};

	const getComparisonModelCollection = collections => {
		return collections
			.map(collection => JSON.parse(collection))
			.find(collection => collection.collectionName === 'comparisonModelCollection');
	};

	/**
	 * @return {{ [key: string]: Array<AlterScriptDto>}}}
	 * */
	const getAlterContainersScriptsDtos = (collection, app, options) => {
		const { getAddContainerScriptDto, getDeleteContainerScriptDto } =
			require('./alterScriptHelpers/alterContainerHelper')(app, options);

		const addedContainers = collection.properties?.containers?.properties?.added?.items;
		const deletedContainers = collection.properties?.containers?.properties?.deleted?.items;

		const addContainersScriptsDtos = []
			.concat(addedContainers)
			.filter(Boolean)
			.map(container => ({
				...Object.values(container.properties)[0],
				name: Object.keys(container.properties)[0],
			}))
			.flatMap(getAddContainerScriptDto);
		const deleteContainersScriptsDtos = []
			.concat(deletedContainers)
			.filter(Boolean)
			.flatMap(container => getDeleteContainerScriptDto(Object.keys(container.properties)[0]));

		return { addContainersScriptsDtos, deleteContainersScriptsDtos };
	};

	/**
	 * @return {{ [key: string]: Array<AlterScriptDto>}}}
	 * */
	const getAlterCollectionsScriptsDtos = (collection, app, options) => {
		const {
			getAddCollectionScriptDto,
			getDeleteCollectionScriptDto,
			getAddColumnScriptDto,
			getDeleteColumnScriptDto,
			getModifyColumnScriptDto,
			getModifyCollectionScriptDto,
		} = require('./alterScriptHelpers/alterEntityHelper')(app, options);

		const createScriptsData = []
			.concat(collection.properties?.entities?.properties?.added?.items)
			.filter(Boolean)
			.map(item => Object.values(item.properties)[0]);

		const deleteScriptsData = []
			.concat(collection.properties?.entities?.properties?.deleted?.items)
			.filter(Boolean)
			.map(item => Object.values(item.properties)[0]);

		const modifyScriptsData = []
			.concat(collection.properties?.entities?.properties?.modified?.items)
			.filter(Boolean)
			.map(item => Object.values(item.properties)[0]);

		const createCollectionsScriptsDtos = createScriptsData
			.filter(collection => collection.compMod?.created)
			.flatMap(getAddCollectionScriptDto);
		const deleteCollectionScriptsDtos = deleteScriptsData
			.filter(collection => collection.compMod?.deleted)
			.flatMap(getDeleteCollectionScriptDto);
		const modifyCollectionScriptsDtos = modifyScriptsData.flatMap(getModifyCollectionScriptDto);
		const addColumnScriptsDtos = createScriptsData
			.filter(collection => !collection.compMod?.created)
			.flatMap(getAddColumnScriptDto);
		const deleteColumnScriptsDtos = deleteScriptsData
			.filter(collection => !collection.compMod?.deleted)
			.flatMap(getDeleteColumnScriptDto);
		const modifyColumnScriptDtos = modifyScriptsData.flatMap(getModifyColumnScriptDto);

		return {
			createCollectionsScriptsDtos,
			deleteCollectionScriptsDtos,
			modifyCollectionScriptsDtos,
			addColumnScriptsDtos,
			deleteColumnScriptsDtos,
			modifyColumnScriptDtos,
		};
	};

	/**
	 * @return {{ [key: string]: Array<AlterScriptDto>}}}
	 * */
	const getAlterViewScriptsDtos = (collection, app, options) => {
		const { getAddViewScriptDto, getDeleteViewScriptDto, getModifiedViewScriptDto } =
			require('./alterScriptHelpers/alterViewHelper')(app, options);

		const checkIfOnlyDescriptionChanged = view => {
			const changedProps = Object.entries(view.role?.compMod).filter(([_, value]) => value.new !== value.old);

			// If the only change is the description, we ignore it
			// descriptions are handled in separate methods
			return !(changedProps.length === 1 && changedProps[0][0] === 'description');
		};

		const createViewsScriptsDtos = []
			.concat(collection.properties?.views?.properties?.added?.items)
			.filter(Boolean)
			.map(item => Object.values(item.properties)[0])
			.map(view => ({ ...view, ...(view.role || {}) }))
			.filter(view => view.compMod?.created)
			.flatMap(getAddViewScriptDto);

		const deleteViewsScriptsDtos = []
			.concat(collection.properties?.views?.properties?.deleted?.items)
			.filter(Boolean)
			.map(item => Object.values(item.properties)[0])
			.map(view => ({ ...view, ...(view.role || {}) }))
			.filter(view => view.compMod?.deleted)
			.flatMap(getDeleteViewScriptDto);

		const modifiedViewsScriptsDtos = []
			.concat(collection.properties?.views?.properties?.modified?.items)
			.filter(Boolean)
			.map(item => Object.values(item.properties)[0])
			.map(view => ({ ...view, ...(view.role || {}) }))
			.filter(view => !view.compMod?.created && !view.compMod?.deleted)
			.filter(checkIfOnlyDescriptionChanged)
			.flatMap(getModifiedViewScriptDto);

		return { deleteViewsScriptsDtos, createViewsScriptsDtos, modifiedViewsScriptsDtos };
	};

	/**
	 * @return {{ [key: string]: Array<AlterScriptDto>}}}
	 * */
	const getAlterModelDefinitionsScriptsDtos = (collection, app, options) => {
		const { getCreateUdtScriptDto, getDeleteUdtScriptDto } = require('./alterScriptHelpers/alterUdtHelper')(
			app,
			options,
		);

		const createUdtScriptsDtos = []
			.concat(collection.properties?.modelDefinitions?.properties?.added?.items)
			.filter(Boolean)
			.map(item => Object.values(item.properties)[0])
			.map(item => ({ ...item, ...(app.require('lodash').omit(item.role, 'properties') || {}) }))
			.filter(item => item.compMod?.created)
			.flatMap(getCreateUdtScriptDto);
		const deleteUdtScriptsDtos = []
			.concat(collection.properties?.modelDefinitions?.properties?.deleted?.items)
			.filter(Boolean)
			.map(item => Object.values(item.properties)[0])
			.map(item => ({ ...item, ...(app.require('lodash').omit(item.role, 'properties') || {}) }))
			.filter(collection => collection.compMod?.deleted)
			.flatMap(getDeleteUdtScriptDto);

		return { deleteUdtScriptsDtos, createUdtScriptsDtos };
	};

	const getAlterRelationshipsScriptDtos = (collection, app) => {
		const _ = app.require('lodash');
		const ddlProvider = require('../ddlProvider')(null, null, app);
		const {
			getModifyForeignKeyScriptDtos,
			getAddForeignKeyScriptDtos,
			getDeleteForeignKeyScriptDtos,
		} = require('./alterScriptHelpers/alterRelationshipsHelper');

		const addedRelationships = []
			.concat(collection.properties?.relationships?.properties?.added?.items)
			.filter(Boolean)
			.map(item => Object.values(item.properties)[0])
			.filter(relationship => relationship?.role?.compMod?.created);
		const deletedRelationships = []
			.concat(collection.properties?.relationships?.properties?.deleted?.items)
			.filter(Boolean)
			.map(item => Object.values(item.properties)[0])
			.filter(relationship => relationship?.role?.compMod?.deleted);
		const modifiedRelationships = []
			.concat(collection.properties?.relationships?.properties?.modified?.items)
			.filter(Boolean)
			.map(item => Object.values(item.properties)[0])
			.filter(relationship => relationship?.role?.compMod?.modified);

		const deleteFkScriptDtos = getDeleteForeignKeyScriptDtos(ddlProvider, _)(deletedRelationships);
		const addFkScriptDtos = getAddForeignKeyScriptDtos(ddlProvider, _)(addedRelationships);
		const modifiedFkScriptDtos = getModifyForeignKeyScriptDtos(ddlProvider, _)(modifiedRelationships);

		return {
			deleteFkScriptDtos,
			addFkScriptDtos,
			modifiedFkScriptDtos,
		};
	};

	const getContainersCommentsAlterScriptsDtos = (collection, app, options) => {
		const { getSchemasDropCommentsAlterScriptsDto, getSchemasModifyCommentsAlterScriptsDto } =
			require('./alterScriptHelpers/alterContainerHelper')(app, options);
		const modifiedSchemas = collection.properties?.containers?.properties?.modified?.items;
		const deletedSchemas = collection.properties?.containers?.properties?.deleted?.items;

		//There is no need for separate added schemas comments creation because it is already done in generation of ddl (just like in FE) and this method is called
		let addSchemasModifyCommentsScriptsDtos = [];
		let addSchemasDropCommentsScriptsDtos = [];

		if (modifiedSchemas) {
			addSchemasModifyCommentsScriptsDtos = Array.isArray(modifiedSchemas)
				? modifiedSchemas.map(schema => getSchemasModifyCommentsAlterScriptsDto(schema?.properties)).flat()
				: getSchemasModifyCommentsAlterScriptsDto(modifiedSchemas?.properties);
		}

		if (deletedSchemas) {
			addSchemasDropCommentsScriptsDtos = Array.isArray(deletedSchemas)
				? deletedSchemas.map(schema => getSchemasDropCommentsAlterScriptsDto(schema?.properties)).flat()
				: getSchemasDropCommentsAlterScriptsDto(deletedSchemas?.properties);
		}

		return {
			addSchemasModifyCommentsScriptsDtos,
			addSchemasDropCommentsScriptsDtos,
		};
	};

	const getCollectionsCommentsAlterScriptsDtos = (collection, app, options) => {
		const {
			getTablesDropCommentAlterScriptsDto,
			getTablesModifyCommentsAlterScriptsDto,
			getColumnsCreateCommentAlterScriptsDto,
			getColumnsDropCommentAlterScriptsDto,
			getColumnsModifyCommentAlterScriptsDto,
		} = require('./alterScriptHelpers/alterEntityHelper')(app, options);
		const modifiedTables = collection.properties?.entities?.properties?.modified?.items;
		const deletedTables = collection.properties?.entities?.properties?.deleted?.items;

		//Added tables comments creation is already done in generation of ddl
		let addTablesModifyCommentsScriptsDtos = [];
		let addTablesDropCommentsScriptsDtos = [];

		// Columns create scripts added for case with modification of tables with new fields with comments
		let addColumnCreateCommentsScripsDtos = [];
		let addColumnModifyCommentsScriptsDtos = [];
		let addColumnDropCommentsScriptsDtos = [];

		if (modifiedTables) {
			addColumnCreateCommentsScripsDtos = Array.isArray(modifiedTables)
				? modifiedTables.map(schema => getColumnsCreateCommentAlterScriptsDto(schema?.properties)).flat()
				: getColumnsCreateCommentAlterScriptsDto(modifiedTables?.properties);
			addTablesModifyCommentsScriptsDtos = Array.isArray(modifiedTables)
				? modifiedTables.map(schema => getTablesModifyCommentsAlterScriptsDto(schema?.properties)).flat()
				: getTablesModifyCommentsAlterScriptsDto(modifiedTables?.properties);
			addColumnModifyCommentsScriptsDtos = Array.isArray(modifiedTables)
				? modifiedTables.map(schema => getColumnsModifyCommentAlterScriptsDto(schema?.properties)).flat()
				: getColumnsModifyCommentAlterScriptsDto(modifiedTables?.properties);
		}

		if (deletedTables) {
			addTablesDropCommentsScriptsDtos = Array.isArray(deletedTables)
				? deletedTables.map(schema => getTablesDropCommentAlterScriptsDto(schema?.properties)).flat()
				: getTablesDropCommentAlterScriptsDto(deletedTables?.properties);
			addColumnDropCommentsScriptsDtos = Array.isArray(deletedTables)
				? deletedTables.map(schema => getColumnsDropCommentAlterScriptsDto(schema?.properties)).flat()
				: getColumnsDropCommentAlterScriptsDto(deletedTables?.properties);
		}

		return {
			addTablesModifyCommentsScriptsDtos,
			addTablesDropCommentsScriptsDtos,
			addColumnCreateCommentsScripsDtos,
			addColumnModifyCommentsScriptsDtos,
			addColumnDropCommentsScriptsDtos,
		};
	};

	const getViewsCommentsAlterScriptsDtos = (collection, app, options) => {
		const { getViewsDropCommentAlterScriptsDto, getViewsModifyCommentsAlterScriptsDto } =
			require('./alterScriptHelpers/alterViewHelper')(app, options);

		//Added views comments creation is already done in generation of ddl
		const modifiedViews = collection.properties?.views?.properties?.modified?.items;
		const deletedViews = collection.properties?.views?.properties?.deleted?.items;

		let addViewsModifyCommentsScriptsDtos = [];
		let addViewsDropCommentsScriptsDtos = [];

		if (modifiedViews) {
			addViewsModifyCommentsScriptsDtos = Array.isArray(modifiedViews)
				? modifiedViews.map(schema => getViewsModifyCommentsAlterScriptsDto(schema?.properties)).flat()
				: getViewsModifyCommentsAlterScriptsDto(modifiedViews?.properties);
		}

		if (deletedViews) {
			addViewsDropCommentsScriptsDtos = Array.isArray(deletedViews)
				? deletedViews.map(schema => getViewsDropCommentAlterScriptsDto(schema?.properties)).flat()
				: getViewsDropCommentAlterScriptsDto(deletedViews?.properties);
		}

		return {
			addViewsModifyCommentsScriptsDtos,
			addViewsDropCommentsScriptsDtos,
		};
	};

	/**
	 * @param scriptDtos {Array<AlterScriptDto>},
	 * @param data {{
	 *     options: {
	 *         id: string,
	 *         value: any,
	 *     },
	 * }}
	 * @return {Array<string>}
	 * */
	const getAlterStatementsWithCommentedUnwantedDDL = (scriptDtos, data) => {
		const { additionalOptions = [] } = data.options || {};
		const applyDropStatements = (additionalOptions.find(option => option.id === 'applyDropStatements') || {}).value;

		const scripts = scriptDtos.flatMap(dto => {
			if (dto.isActivated === false) {
				return dto.scripts.map(scriptDto => commentDeactivatedStatements(scriptDto.script, false));
			}

			if (!applyDropStatements) {
				return dto.scripts.map(scriptDto =>
					commentDeactivatedStatements(scriptDto.script, !scriptDto.isDropScript),
				);
			}

			return dto.scripts.map(scriptDto => scriptDto.script);
		});

		return assertNoEmptyStatements(scripts);
	};

	/**
	 * @return Array<AlterScriptDto>
	 * */
	const getAlterScriptDtos = (collection, app, options) => {
		const script = {
			...getAlterCollectionsScriptsDtos(collection, app, options),
			...getAlterContainersScriptsDtos(collection, app, options),
			...getAlterViewScriptsDtos(collection, app, options),
			...getAlterModelDefinitionsScriptsDtos(collection, app, options),
			...getContainersCommentsAlterScriptsDtos(collection, app, options),
			...getCollectionsCommentsAlterScriptsDtos(collection, app, options),
			...getViewsCommentsAlterScriptsDtos(collection, app, options),
			...getAlterRelationshipsScriptDtos(collection, app),
		};

		return [
			'addContainersScriptsDtos',
			'addViewsDropCommentsScriptsDtos',
			'deleteViewsScriptsDtos',
			'addColumnDropCommentsScriptsDtos',
			'addTablesDropCommentsScriptsDtos',
			'deleteCollectionScriptsDtos',
			'deleteUdtScriptsDtos',
			'createUdtScriptsDtos',
			'createCollectionsScriptsDtos',
			'addColumnScriptsDtos',
			'modifyColumnScriptDtos',
			'modifyCollectionScriptsDtos',
			'deleteColumnScriptsDtos',
			'createViewsScriptsDtos',
			'modifiedViewsScriptsDtos',
			'addSchemasDropCommentsScriptsDtos',
			'deleteContainersScriptsDtos',
			'addColumnCreateCommentsScripsDtos',
			'addColumnModifyCommentsScriptsDtos',
			'addSchemasModifyCommentsScriptsDtos',
			'addTablesModifyCommentsScriptsDtos',
			'addViewsModifyCommentsScriptsDtos',
			'deleteFkScriptDtos',
			'addFkScriptDtos',
			'modifiedFkScriptDtos',
		]
			.flatMap(name => script[name])
			.filter(Boolean);
	};

	/**
	 * @param alterScriptDtos {Array<AlterScriptDto>}
	 * @param data {{
	 *     options: {
	 *         id: string,
	 *         value: any,
	 *     },
	 * }}
	 * @return {string}
	 * */
	const joinAlterScriptDtosIntoAlterScript = (alterScriptDtos, data) => {
		const scriptAsStringsWithCommentedUnwantedDDL = getAlterStatementsWithCommentedUnwantedDDL(
			alterScriptDtos,
			data,
		);

		return buildScript(scriptAsStringsWithCommentedUnwantedDDL);
	};

	return {
		getAlterScriptDtos,
		getComparisonModelCollection,
		getAlterContainersScriptsDtos,
		getAlterCollectionsScriptsDtos,
		getAlterViewScriptsDtos,
		getAlterModelDefinitionsScriptsDtos,
		joinAlterScriptDtosIntoAlterScript,
	};
};
