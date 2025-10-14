const fs = require('fs');
const sql = require('mssql');
const { hckFetch } = require('@hackolade/fetch');

const QUERY_REQUEST_TIMEOUT = 60000;

async function getConnectionClient({ connectionInfo, logger }) {
	const userName = getUserName({ connectionInfo });
	const tenantId = connectionInfo.connectionTenantId || connectionInfo.tenantId || 'common';
	const clientId = '0dc36597-bc44-49f8-a4a7-ae5401959b85';
	const sslOptions = getSslConfig({ connectionInfo });
	const timeout = Number(connectionInfo.queryRequestTimeout) || QUERY_REQUEST_TIMEOUT;

	switch (connectionInfo.authMethod) {
		case 'Username / Password':
			return await connectWithBasicAuth({ connectionInfo, userName, sslOptions, timeout });
		case 'Username / Password (Windows)':
			return await connectWithWindowsAuth({ connectionInfo, userName, sslOptions, timeout });
		case 'Azure Active Directory (MFA)':
			return await connectWithAzureMFA({ connectionInfo, sslOptions, tenantId, clientId, logger });
		case 'Azure Active Directory (Username / Password)':
			return await connectWithAzurePassword({
				connectionInfo,
				userName,
				sslOptions,
				timeout,
				tenantId,
				clientId,
			});
		default:
			return await sql.connect(connectionInfo.connectionString);
	}
}

function getBaseConnectionConfig({ connectionInfo, timeout }) {
	return {
		server: connectionInfo.host,
		port: parseInt(connectionInfo.port, 10),
		database: connectionInfo.databaseName,
		connectTimeout: timeout,
		requestTimeout: timeout,
	};
}

async function connectWithBasicAuth({ connectionInfo, userName, sslOptions, timeout }) {
	const encrypt = connectionInfo.encryptConnection === undefined ? true : Boolean(connectionInfo.encryptConnection);

	return await sql.connect({
		...getBaseConnectionConfig({ connectionInfo, timeout }),
		user: userName,
		password: connectionInfo.userPassword,
		options: {
			enableArithAbort: true,
			encrypt,
			...sslOptions,
		},
	});
}

async function connectWithWindowsAuth({ connectionInfo, userName, sslOptions, timeout }) {
	const encrypt =
		connectionInfo.encryptWindowsConnection === undefined
			? false
			: Boolean(connectionInfo.encryptWindowsConnection);

	return await sql.connect({
		...getBaseConnectionConfig({ connectionInfo, timeout }),
		user: userName,
		password: connectionInfo.userPassword,
		domain: connectionInfo.userDomain,
		options: {
			...sslOptions,
			encrypt,
			enableArithAbort: true,
		},
	});
}

async function connectWithAzureMFA({ connectionInfo, sslOptions, tenantId, clientId, logger }) {
	const redirectUri = 'http://localhost:8080';
	const token = await getMFAToken({ connectionInfo, tenantId, clientId, redirectUri, logger });

	return await sql.connect({
		...getBaseConnectionConfig({ connectionInfo, timeout: QUERY_REQUEST_TIMEOUT }),
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
	});
}

async function connectWithAzurePassword({ connectionInfo, userName, sslOptions, timeout, tenantId, clientId }) {
	return await sql.connect({
		...getBaseConnectionConfig({ connectionInfo, timeout }),
		user: userName,
		password: connectionInfo.userPassword,
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
	});
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

async function parseResponse(response) {
	if (response.status !== 200) {
		const errorMessage = await response.text();
		throw new Error(errorMessage);
	}

	return response.json();
}

function getUserName({ connectionInfo }) {
	const hostName = getHostName(connectionInfo.host);
	return isEmail(connectionInfo.userName) && hostName
		? `${connectionInfo.userName}@${hostName}`
		: connectionInfo.userName;
}

function getHostName(url) {
	return (url || '').split('.')[0];
}
function isEmail(name) {
	if (!name || name.length > 320) {
		return false;
	}

	return /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(name);
}

module.exports = {
	getConnectionClient,
};
