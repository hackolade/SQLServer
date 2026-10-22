'use strict';

const { hckFetch } = require('@hackolade/fetch');

const { getEntraOAuthConfig, loadOauthModule, resolveAuthorizeTenant } = require('./entraOAuthConfig');

const REDIRECT_URI = 'http://localhost:8080';
const REDIRECT_PORT = 8080;

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

const exchangeAuthorizationCode = async ({ app, connectionInfo, logger } = {}) => {
	try {
		const { productionClientId, tokenEndpoint } = getEntraOAuthConfig({ app });
		const urlParams = new URLSearchParams();

		urlParams.append('code', connectionInfo?.externalBrowserQuery?.code || '');
		urlParams.append('client_id', productionClientId);
		urlParams.append('redirect_uri', REDIRECT_URI);
		urlParams.append('grant_type', 'authorization_code');
		urlParams.append('code_verifier', connectionInfo?.proofKey);

		const response = await hckFetch(tokenEndpoint, {
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

const getMfaAccessToken = async ({ app, connectionInfo, logger } = {}) => {
	const oauth = loadOauthModule({ app });

	if (!oauth) {
		return exchangeAuthorizationCode({ app, connectionInfo, logger });
	}

	const { productionClientId, authorizationEndpoint, tokenEndpoint } = oauth.getEntraIdOAuthConfig({
		tenantId: resolveAuthorizeTenant({ connectionInfo }),
	});
	const { accessToken } = await oauth.getUserToMachineAccessToken({
		authorizationEndpoint,
		tokenEndpoint,
		clientId: productionClientId,
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

const isEntraMfa = ({ connectionInfo } = {}) => connectionInfo?.authMethod === 'Azure Active Directory (MFA)';

const canRequestUserToMachineAccessToken = ({ app, connectionInfo } = {}) => {
	if (!isEntraMfa({ connectionInfo })) {
		return false;
	}

	return Boolean(loadOauthModule({ app }));
};

const shouldUseExternalBrowser = ({ app, connectionInfo } = {}) =>
	isEntraMfa({ connectionInfo }) && !canRequestUserToMachineAccessToken({ app, connectionInfo });

module.exports = {
	getMfaAccessToken,
	canRequestUserToMachineAccessToken,
	shouldUseExternalBrowser,
};
