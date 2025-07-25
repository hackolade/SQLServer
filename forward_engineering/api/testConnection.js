const { getExternalBrowserUrl, connect } = require('../../reverse_engineering/api');
const logInfo = require('../../reverse_engineering/helpers/logInfo');
const { logDatabaseVersion } = require('../../reverse_engineering/reverseEngineeringService/reverseEngineeringService');

async function getExternalBrowserUrlLocal(connectionInfo, logger, cb, app) {
	return getExternalBrowserUrl(connectionInfo, logger, cb, app);
}

async function testConnection(connectionInfo, logger, callback, app) {
	try {
		logInfo('Test connection', connectionInfo, logger);
		if (connectionInfo.authMethod === 'Azure Active Directory (MFA)') {
			await getExternalBrowserUrlLocal(connectionInfo, logger, callback, app);
		} else {
			const client = await connect(connectionInfo, logger, () => {}, app);
			await logDatabaseVersion({ client, logger });
		}
		callback(null);
	} catch (error) {
		logger.log('error', { message: error.message, stack: error.stack, error }, 'Test connection');
		callback({ message: error.message, stack: error.stack });
	}
}

module.exports = {
	testConnection,
	getExternalBrowserUrl: getExternalBrowserUrlLocal,
};
