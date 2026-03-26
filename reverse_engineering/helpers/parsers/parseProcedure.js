/**
 * @typedef {object} RawProcedure
 * @property {string} schema_name
 * @property {string} procedure_name
 * @property {string|null} procedure_body
 *
 * @typedef {object} Procedure
 * @property {string} name
 * @property {string} schemaName
 * @property {boolean} orReplace
 * @property {string} [inputArgs]
 * @property {string} [body]
 * @property {string} [encryption]
 * @property {string} [recompile]
 * @property {string} [forReplication]
 * @property {string} [executeAs]
 */

const createProcedureRegexp =
	/CREATE(?<orReplace>\s*OR\s*ALTER)?\s*(?:PROC|PROCEDURE)\s*(?:[^\s(]+)\s*(?<inputArgs>\((?:[^()']+|'[^']*'|\([^()]*\))*\)|(?:\s*@\w+[^@]*?)*?)?\s*(?<parameters>(?:WITH\s*(?:ENCRYPTION|RECOMPILE|,\s*|EXECUTE\s*AS\s*(?:OWNER|CALLER|SELF|'[^']+'))+)(?:\s*FOR\s*REPLICATION)?)?\s*AS\s*(?<body>\bBEGIN(?:[\s\S]+)(?:\bEND|\bRETURN\s+[^;\n]+))/im;

const encryptionRegexp = /WITH[\s\S]*\b(?<value>ENCRYPTION)/i;
const recompileRegexp = /WITH[\s\S]*\b(?<value>RECOMPILE)/i;
const executeAsRegexp = /WITH[\s\S]*(?:EXECUTE AS\s*(?<value>(?:CALLER|SELF|OWNER|'[^']+')))/i;
const forReplicationRegexp = /\b(?<value>FOR\sREPLICATION)/i;

/**
 *
 * @param {string} parametersStatement
 */
const parseParameters = parametersStatement => {
	if (!parametersStatement) {
		return {};
	}

	const hasEncryption = encryptionRegexp.test(parametersStatement);
	const hasRecompile = recompileRegexp.test(parametersStatement);
	const hasForReplication = forReplicationRegexp.test(parametersStatement);
	const hasExecuteAs = executeAsRegexp.test(parametersStatement);
	const executeAs = hasExecuteAs && executeAsRegexp.exec(parametersStatement)[1];

	return {
		...(hasEncryption && { encryption: 'ENCRYPTION' }),
		...(hasRecompile && { recompile: 'RECOMPILE' }),
		...(hasForReplication && { forReplication: 'FOR REPLICATION' }),
		...(executeAs && { executeAs }),
	};
};
/**
 *
 * @param {RawProcedure} rawProcedure
 * @returns {Procedure}
 */
const parseProcedure = rawProcedure => {
	const { schema_name, procedure_name, procedure_body } = rawProcedure;

	if (!procedure_body) {
		return {
			name: procedure_name,
			schemaName: schema_name,
			encryption: 'ENCRYPTION',
		};
	}
	const result = createProcedureRegexp.exec(procedure_body);
	const { orReplace, inputArgs, parameters, body } = result.groups;
	const procedureParameters = parseParameters(parameters);

	return {
		name: procedure_name,
		schemaName: schema_name,
		orReplace: !!orReplace,
		inputArgs,
		body,
		...procedureParameters,
	};
};

module.exports = {
	parseProcedure,
};
