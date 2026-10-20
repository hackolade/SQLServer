'use strict';

const { hckFetch } = require('@hackolade/fetch');

const OAUTH_MODULE = '@hackolade/oauth';
const OAUTH_NOT_EXPOSED_MESSAGE = `The module ${OAUTH_MODULE} is not exposed by the application to the plugins!`;
const ENTRA_CLIENT_ID = '0dc36597-bc44-49f8-a4a7-ae5401959b85';
const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token';
const REDIRECT_URI = 'http://localhost:8080';
const REDIRECT_PORT = 8080;

const getAuthorizeTenant = ({ connectionInfo = {} } = {}) =>
	connectionInfo.connectionTenantId || connectionInfo.tenantId || 'common';

const getAuthorizationQuery = ({ connectionInfo = {} } = {}) => {
	const authorizationQuery = {
		prompt: 'select_account',
		response_mode: 'query',
		resource: 'https://database.windows.net/',
	};

	if (!connectionInfo.loginHint) {
		return authorizationQuery;
	}

	return {
		...authorizationQuery,
		login_hint: connectionInfo.loginHint,
	};
};

const parseResponse = async response => {
	if (response.status !== 200) {
		const errorMessage = await response.text();
		throw new Error(errorMessage);
	}

	return response.json();
};

const exchangeAuthorizationCode = async ({ connectionInfo, logger } = {}) => {
	try {
		const urlParams = new URLSearchParams();

		urlParams.append('code', connectionInfo?.externalBrowserQuery?.code || '');
		urlParams.append('client_id', ENTRA_CLIENT_ID);
		urlParams.append('redirect_uri', REDIRECT_URI);
		urlParams.append('grant_type', 'authorization_code');
		urlParams.append('code_verifier', connectionInfo?.proofKey);

		const response = await hckFetch(TOKEN_ENDPOINT, {
			method: 'POST',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/x-www-form-urlencoded',
				'Origin': 'http://localhost',
			},
			body: urlParams,
		});
		const responseData = await parseResponse(response);

		return responseData?.access_token || '';
	} catch (error) {
		logger.log('error', { message: error.message, stack: error.stack, error }, 'MFA auth error');

		return '';
	}
};

const loadOauthModule = ({ app } = {}) => {
	try {
		return app.require(OAUTH_MODULE);
	} catch (error) {
		if (error?.message === OAUTH_NOT_EXPOSED_MESSAGE) {
			return null;
		}

		throw error;
	}
};

const getMfaAccessToken = async ({ app, connectionInfo, logger } = {}) => {
	const oauth = loadOauthModule({ app });

	if (!oauth) {
		return exchangeAuthorizationCode({ connectionInfo, logger });
	}

	const { accessToken } = await oauth.getUserToMachineAccessToken({
		authorizationEndpoint: `https://login.microsoftonline.com/${getAuthorizeTenant({ connectionInfo })}/oauth2/authorize`,
		tokenEndpoint: TOKEN_ENDPOINT,
		clientId: ENTRA_CLIENT_ID,
		port: REDIRECT_PORT,
		failOnPortConflict: true,
		authorizationQuery: getAuthorizationQuery({ connectionInfo }),
		headers: {
			Origin: 'http://localhost',
		},
	});

	if (!accessToken) {
		throw new Error('Entra token response did not include an access token.');
	}

	return accessToken;
};

const isUserToMachineOauthAvailable = ({ app } = {}) => Boolean(loadOauthModule({ app }));

module.exports = {
	getMfaAccessToken,
	isUserToMachineOauthAvailable,
};
