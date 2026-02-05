const _ = require('lodash');
const { AlterScriptDto } = require('./types/AlterScriptDto');
const { getDbData } = require('../../utils/general');

const alterContainerHelper = (app, options) => {
	const ddlProvider = require('../../ddlProvider')(null, options, app);

	const getAddContainerScriptDto = containerData => {
		const constructedDbData = getDbData([containerData]);
		const schemaData = ddlProvider.hydrateSchema(constructedDbData, {
			udfs: containerData.role?.UDFs,
			procedures: containerData.role?.Procedures,
			useDb: false,
		});

		return AlterScriptDto.getInstance([_.trim(ddlProvider.createSchema(schemaData))], true, false);
	};

	const getDeleteContainerScriptDto = containerName => {
		return AlterScriptDto.getInstance([ddlProvider.dropSchema(containerName)], true, true);
	};

	const getUpdateSchemaCommentScript = ({ schemaName, comment }) =>
		ddlProvider.updateSchemaComment({
			schemaName,
			comment,
		});
	const getDropSchemaCommentScript = ({ schemaName }) => ddlProvider.dropSchemaComment({ schemaName });

	const getSchemasDropCommentsAlterScriptsDto = schemas =>
		Object.keys(schemas).map(schemaName => {
			if (!schemas[schemaName]?.role?.description) {
				return undefined;
			}

			const script = getDropSchemaCommentScript({ schemaName });

			return AlterScriptDto.getInstance([script], true, true);
		});

	const getSchemasModifyCommentsAlterScriptsDto = schemas => {
		return Object.keys(schemas).map(schemaName => {
			let script = '';
			const schemaComparison = schemas[schemaName].role?.compMod;
			const newComment = schemaComparison?.description?.new;
			const oldComment = schemaComparison?.description?.old;
			const isCommentRemoved = oldComment && !newComment;

			if (isCommentRemoved) {
				script = getDropSchemaCommentScript({ schemaName });

				return AlterScriptDto.getInstance([script], true, true);
			}

			if (!newComment || newComment === oldComment) {
				return undefined;
			}

			if (oldComment) {
				script = getUpdateSchemaCommentScript({ schemaName, comment: newComment });
			} else {
				script = ddlProvider.createSchemaComment({
					schemaName,
					comment: newComment,
				});
			}

			return AlterScriptDto.getInstance([script], true, false);
		});
	};

	return {
		getAddContainerScriptDto,
		getDeleteContainerScriptDto,
		getSchemasDropCommentsAlterScriptsDto,
		getSchemasModifyCommentsAlterScriptsDto,
	};
};

module.exports = alterContainerHelper;
