const _ = require('lodash');
const { connect } = require('../../reverse_engineering/api');
const { filterDeactivatedQuery, queryIsDeactivated } = require('./commentIfDeactivated');

const GO_STATEMENT = 'GO';

const applyToInstance = async (connectionInfo, logger, app) => {
	const async = app.require('async');

	try {
		const client = await connect(connectionInfo, logger, () => {}, app);
		if (!client.config.database) {
			throw new Error('No database specified');
		}
		const queries = getQueries(connectionInfo.script);

		await async.mapSeries(queries, async query => {
			const message = `Query: ${query.split('\n').shift().substring(0, 150)}`;
			logger.progress({ message });
			logger.log('info', { message }, 'Apply to instance');

			await client.query(query);
		});
	} catch (error) {
		logger.log('error', { message: error.message, stack: error.stack, error: error }, 'Error applying to instance');
		throw prepareError(error);
	}
};

const getQueries = (script = '') => {
	script = filterDeactivatedQuery(script);
	return script
		.split('\n\n')
		.map((script = '') => {
			script = script.trim().endsWith(GO_STATEMENT) ? script.slice(0, -2) : script;
			return _.trim(script, ';');
		})
		.filter(query => Boolean(query) && !queryIsDeactivated(query));
};

const prepareError = error => {
	error = JSON.stringify(error, Object.getOwnPropertyNames(error));
	return JSON.parse(error);
};

module.exports = { applyToInstance };
