const { generateScript } = require('./generateScript');

function generateContainerScript(data, logger, callback, app) {
	try {
		data.jsonSchema = data.collections[0];
		generateScript(data, logger, callback, app);
	} catch (error) {
		logger.log('error', { message: error.message, stack: error.stack }, 'MS SQL Server Forward-Engineering Error');

		callback({ message: error.message, stack: error.stack });
	}
}

module.exports = {
	generateContainerScript,
};
