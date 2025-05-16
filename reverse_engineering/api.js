'use strict';

const crypto = require('crypto');
const randomstring = require('randomstring');
const base64url = require('base64url');
const { clientManager } = require('./clientManager');
const { getObjectsFromDatabase, getDatabaseCollationOption } = require('./databaseService/databaseService');
const {
	reverseCollectionsToJSON,
	mergeCollectionsWithViews,
	getCollectionsRelationships,
	logDatabaseVersion,
} = require('./reverseEngineeringService/reverseEngineeringService');
const logInfo = require('./helpers/logInfo');
const { getJsonSchemasWithInjectedDescriptionComments } = require('./helpers/commentsHelper');
const filterRelationships = require('./helpers/filterRelationships');
const getOptionsFromConnectionInfo = require('./helpers/getOptionsFromConnectionInfo');
const { adaptJsonSchema } = require('./helpers/adaptJsonSchema');
const { parseConnectionString } = require('./helpers/parseConnectionString');
const { prepareError } = require('./databaseService/helpers/errorService');

module.exports = {
	async connect(connectionInfo, logger, callback, app) {
		const client = clientManager.getClient();

		if (!client) {
			return await clientManager.initClient({
				connectionInfo,
				logger,
				sshService: app.require('@hackolade/ssh-service'),
			});
		}

		return client;
	},

	disconnect(connectionInfo, logger, callback) {
		clientManager.clearClient();
		callback();
	},

	async testConnection(connectionInfo, logger, callback, app) {
		try {
			logInfo('Test connection', connectionInfo, logger);
			if (connectionInfo.authMethod === 'Azure Active Directory (MFA)') {
				await this.getExternalBrowserUrl(connectionInfo, logger, callback, app);
			} else {
				const client = await this.connect(connectionInfo, logger, () => {}, app);
				await logDatabaseVersion({ client, logger });
			}
			callback();
		} catch (error) {
			const errorWithUpdatedInfo = prepareError({ error });
			logger.log(
				'error',
				{
					message: errorWithUpdatedInfo.message,
					stack: errorWithUpdatedInfo.stack,
					error: errorWithUpdatedInfo,
				},
				'Test connection',
			);
			callback({ message: errorWithUpdatedInfo.message, stack: errorWithUpdatedInfo.stack });
		}
	},

	async getExternalBrowserUrl(connectionInfo, logger, cb, app) {
		const verifier = randomstring.generate(32);
		const base64Digest = crypto.createHash('sha256').update(verifier).digest('base64');
		const challenge = base64url.fromBase64(base64Digest);
		const tenantId = connectionInfo.connectionTenantId || connectionInfo.tenantId || 'common';
		const clientId = '0dc36597-bc44-49f8-a4a7-ae5401959b85';
		const loginHint = connectionInfo.loginHint ? `login_hint=${encodeURIComponent(connectionInfo.loginHint)}&` : '';
		const redirectUrl = `http://localhost:${connectionInfo.redirectPort || 8080}`;

		cb(null, {
			proofKey: verifier,
			url: `https://login.microsoftonline.com/${tenantId}/oauth2/authorize?${loginHint}code_challenge_method=S256&code_challenge=${challenge}&response_type=code&response_mode=query&client_id=${clientId}&redirect_uri=${redirectUrl}&prompt=select_account&resource=https://database.windows.net/`,
		});
	},

	getDatabases(connectionInfo, logger, callback, app) {
		callback();
	},

	getDocumentKinds(connectionInfo, logger, callback, app) {
		callback();
	},

	async getDbCollectionsNames(connectionInfo, logger, callback, app) {
		try {
			logInfo('Retrieving databases and tables information', connectionInfo, logger);

			const client = await this.connect(connectionInfo, logger, () => {}, app);
			if (!client.config.database) {
				throw new Error('No database specified');
			}

			await logDatabaseVersion({ client, logger });

			const objects = await getObjectsFromDatabase(client);
			const dbName = client.config.database;
			const collationData = (await getDatabaseCollationOption({ client, dbName, logger })) || [];
			logger.log('info', { collation: collationData[0] }, 'Database collation');
			callback(null, objects);
		} catch (error) {
			const errorWithUpdatedInfo = prepareError({ error });
			logger.log(
				'error',
				{
					message: errorWithUpdatedInfo.message,
					stack: errorWithUpdatedInfo.stack,
					error: errorWithUpdatedInfo,
				},
				'Retrieving databases and tables information',
			);
			callback({ message: errorWithUpdatedInfo.message, stack: errorWithUpdatedInfo.stack });
		}
	},

	async getDbCollectionsData(collectionsInfo, logger, callback, app) {
		try {
			logger.log('info', collectionsInfo, 'Retrieving schema', collectionsInfo.hiddenKeys);
			logger.progress({ message: 'Start reverse-engineering process', containerName: '', entityName: '' });
			const { collections } = collectionsInfo.collectionData;
			const client = clientManager.getClient();
			const dbName = client?.config.database;
			if (!client || !dbName) {
				throw new Error('No database specified');
			}

			const reverseEngineeringOptions = getOptionsFromConnectionInfo(collectionsInfo);
			const [jsonSchemas, relationships] = await Promise.all([
				await reverseCollectionsToJSON({ client, tablesInfo: collections, reverseEngineeringOptions, logger }),
				await getCollectionsRelationships({ client, tablesInfo: collections, logger }),
			]);

			const jsonSchemasWithDescriptionComments = await getJsonSchemasWithInjectedDescriptionComments({
				client,
				dbName,
				jsonSchemas,
				logger,
			});
			callback(
				null,
				mergeCollectionsWithViews({ jsonSchemas: jsonSchemasWithDescriptionComments }),
				null,
				filterRelationships(relationships, jsonSchemasWithDescriptionComments),
			);
		} catch (error) {
			logger.log(
				'error',
				{ message: error.message, stack: error.stack, error },
				'Reverse-engineering process failed',
			);
			callback({ message: error.message, stack: error.stack });
		}
	},

	parseConnectionString({ connectionString = '' }, logger, callback) {
		try {
			const authMethod = 'Username / Password';
			const parsedData = parseConnectionString({ string: connectionString });

			callback(null, {
				parsedData: {
					authMethod,
					...parsedData,
				},
			});
		} catch (err) {
			logger.log('error', { message: err.message, stack: err.stack, err }, 'Parsing connection string failed');
			callback({ message: err.message, stack: err.stack });
		}
	},

	adaptJsonSchema,
};
