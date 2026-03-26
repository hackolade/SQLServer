const { trim } = require('lodash');
const { clean, tab } = require('../utils/general');

/**
 * @typedef {import('../types.d.ts').Procedure} Procedure
 */

/**
 *
 * @param {Procedure[]} procedures
 * @returns {Procedure[]}
 */
const hydrateProcedures = procedures => {
	if (!Array.isArray(procedures)) {
		return [];
	}

	return procedures
		.map(procedure => {
			return clean({
				name: procedure.name || undefined,
				orReplace: procedure.orReplace || undefined,
				inputArgs: procedure.inputArgs ? tab(trim(procedure.inputArgs)) : undefined,
				body: procedure.body || undefined,
				description: procedure.description || undefined,
				encryption: procedure.encryption || undefined,
				recompile: procedure.recompile || undefined,
				forReplication: procedure.forReplication || undefined,
				executeAs: procedure.executeAs || undefined,
			});
		})
		.filter(procedure => procedure.name);
};

/**
 *
 * @param {object} params
 * @param {string} [params.encryption]
 * @param {string} [params.recompile]
 * @param {string} [params.executeAs]
 * @param {string} [params.forReplication]
 * @returns {string}
 */
const getParameters = ({ encryption, recompile, executeAs, forReplication }) => {
	const executeAsClause = executeAs ? `EXECUTE AS ${executeAs}` : '';
	const parametersClause = [encryption, recompile, executeAsClause].filter(Boolean).join(', ');
	const withParametersClause = parametersClause ? `\nWITH ${parametersClause}` : '';
	const forReplicationClause = forReplication ? `\n${forReplication}` : '';

	return `${withParametersClause}${forReplicationClause}`;
};

module.exports = {
	getParameters,
	hydrateProcedures,
};
