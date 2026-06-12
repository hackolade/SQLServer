const getOptionsFromConnectionInfo = connectionInfo => ({
	includeEmptyCollection: connectionInfo.includeEmptyCollection,
	isFieldOrderAlphabetic: connectionInfo.fieldInference.active === 'alphabetical',
	includeProcedures: connectionInfo.includeProcedures || false,
	recordSamplingSettings: {
		...connectionInfo.recordSamplingSettings,
	},
});

module.exports = getOptionsFromConnectionInfo;
