const applyToInstanceHelper = require('../helpers/applyToInstanceHelper');
const logInfo = require('../../reverse_engineering/helpers/logInfo');

async function applyToInstance(connectionInfo, logger, callback, app) {
	logger.clear();
	logInfo('Apply To Instance', connectionInfo, logger);

	try {
		await applyToInstanceHelper.applyToInstance(connectionInfo, logger, app);
		callback(null);
	} catch (error) {
		callback(error);
	}
}

module.exports = {
	applyToInstance,
};
