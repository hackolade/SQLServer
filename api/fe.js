const { generateScript } = require('../forward_engineering/api/generateScript');
const { generateContainerScript } = require('../forward_engineering/api/generateContainerScript');
const { isDropInStatements } = require('../forward_engineering/api/isDropInStatements');

module.exports = {
	generateScript,
	generateViewScript(data, logger, callback, app) {
		callback(new Error('Forward-Engineering of delta model on view level is not supported'));
	},
	generateContainerScript,
	isDropInStatements,
};
