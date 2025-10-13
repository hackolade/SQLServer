const fs = require('fs');
const sql = require('mssql');
const { hckFetch } = require('@hackolade/fetch');

const QUERY_REQUEST_TIMEOUT = 60000;

async function getConnectionClient({ connectionInfo, logger }) {
	const hostName = getHostName(connectionInfo.host);
	const userName =
		isEmail(connectionInfo.userName) && hostName
			? `${connectionInfo.userName}@${hostName}`
			: connectionInfo.userName;
	const tenantId = connectionInfo.connectionTenantId || connectionInfo.tenantId || 'common';
	const clientId = '0dc36597-bc44-49f8-a4a7-ae5401959b85';
	const sslOptions = getSslConfig({ connectionInfo });
	const timeout = Number(connectionInfo.queryRequestTimeout) || QUERY_REQUEST_TIMEOUT;

	if (connectionInfo.authMethod === 'Username / Password') {
		return await sql.connect({
			user: userName,
			password: connectionInfo.userPassword,
			server: connectionInfo.host,
			port: +connectionInfo.port,
			database: connectionInfo.databaseName,
			options: {
				enableArithAbort: true,
				encrypt:
					connectionInfo.encryptConnection === undefined ? true : Boolean(connectionInfo.encryptConnection),
				...sslOptions,
			},
			connectTimeout: timeout,
			requestTimeout: timeout,
		});
	} else if (connectionInfo.authMethod === 'Username / Password (Windows)') {
		return await sql.connect({
			user: userName,
			password: connectionInfo.userPassword,
			server: connectionInfo.host,
			port: +connectionInfo.port,
			database: connectionInfo.databaseName,
			domain: connectionInfo.userDomain,
			options: {
				...sslOptions,
				encrypt:
					connectionInfo.encryptWindowsConnection === undefined
						? false
						: Boolean(connectionInfo.encryptWindowsConnection),
				enableArithAbort: true,
			},
			connectTimeout: timeout,
			requestTimeout: timeout,
		});
	} else if (connectionInfo.authMethod === 'Azure Active Directory (MFA)') {
		const redirectUri = 'http://localhost:8080';
		const token = await getMFAToken({ connectionInfo, tenantId, clientId, redirectUri, logger });

		return await sql.connect({
			server: connectionInfo.host,
			port: +connectionInfo.port,
			database: connectionInfo.databaseName,
			options: {
				...sslOptions,
				encrypt: true,
				enableArithAbort: true,
			},
			authentication: {
				type: 'azure-active-directory-access-token',
				options: {
					token,
				},
			},
			connectTimeout: QUERY_REQUEST_TIMEOUT,
			requestTimeout: QUERY_REQUEST_TIMEOUT,
		});
	} else if (connectionInfo.authMethod === 'Azure Active Directory (Username / Password)') {
		return await sql.connect({
			user: userName,
			password: connectionInfo.userPassword,
			server: connectionInfo.host,
			port: +connectionInfo.port,
			database: connectionInfo.databaseName,
			options: {
				...sslOptions,
				encrypt: true,
				enableArithAbort: true,
			},
			authentication: {
				type: 'azure-active-directory-password',
				options: {
					userName: connectionInfo.userName,
					password: connectionInfo.userPassword,
					tenantId,
					clientId,
				},
			},
			connectTimeout: timeout,
			requestTimeout: timeout,
		});
	}

	return await sql.connect(connectionInfo.connectionString);
}

function getSslConfig({ connectionInfo }) {
	if (connectionInfo.sslType === 'SYSTEMCA') {
		return {};
	}

	if (connectionInfo.sslType === 'TRUST_ALL_CERTIFICATES') {
		return {
			trustServerCertificate: true,
		};
	}

	if (connectionInfo.sslType === 'TRUST_CUSTOM_CA_SIGNED_CERTIFICATES') {
		return {
			cryptoCredentialsDetails: {
				ca: fs.readFileSync(connectionInfo.certAuthority),
			},
		};
	}

	if (connectionInfo.sslType === 'TRUST_SERVER_CLIENT_CERTIFICATES') {
		return {
			cryptoCredentialsDetails: {
				ca: fs.readFileSync(connectionInfo.certAuthority),
				cert: connectionInfo.clientCert && fs.readFileSync(connectionInfo.clientCert),
				key: connectionInfo.clientPrivateKey && fs.readFileSync(connectionInfo.clientPrivateKey),
				passphrase: connectionInfo.passphrase,
			},
		};
	}

	return {};
}

async function getMFAToken({ connectionInfo, tenantId, redirectUri, clientId, logger, agent }) {
	try {
		const urlParams = new URLSearchParams();
		urlParams.append('code', connectionInfo?.externalBrowserQuery?.code || '');
		urlParams.append('client_id', clientId);
		urlParams.append('redirect_uri', redirectUri);
		urlParams.append('grant_type', 'authorization_code');
		urlParams.append('code_verifier', connectionInfo?.proofKey);

		const options = {
			method: 'POST',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/x-www-form-urlencoded',
				'Origin': 'http://localhost',
			},
			body: urlParams,
		};

		const response = await hckFetch(`https://login.microsoftonline.com/organizations/oauth2/v2.0/token`, options);
		const parsedResponse = await parseResponse(response);

		return parsedResponse?.access_token || '';
	} catch (error) {
		logger.log('error', { message: error.message, stack: error.stack, error }, 'MFA auth error');
		return '';
	}
}

/**
 * @param {Response} response
 */
async function parseResponse(response) {
	if (response.status !== 200) {
		const errorMessage = await response.text();
		throw new Error(errorMessage);
	}

	return response.json();
}

function getHostName(url) {
	return (url || '').split('.')[0];
}
function isEmail(name) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name || '');
}

module.exports = {
	getConnectionClient,
};
