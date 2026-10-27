'use strict';

const { hckFetch } = require('@hackolade/fetch');

const { getLegacyEntraOAuthConfig, loadOauthModule, resolveAuthorizeTenant } = require('./entraOAuthConfig');

const DEFAULT_EXTERNAL_BROWSER_PORT = 8080;

const resolveExternalBrowserPort = ({ connectionInfo = {} } = {}) =>
	connectionInfo.redirectPort ?? connectionInfo.externalBrowserPort ?? DEFAULT_EXTERNAL_BROWSER_PORT;

const buildRedirectUri = ({ connectionInfo = {} } = {}) =>
	`http://localhost:${resolveExternalBrowserPort({ connectionInfo })}`;

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
		const tenantId = resolveAuthorizeTenant({ connectionInfo });
		const { productionClientId, tokenEndpoint, desktopTokenRequestHeaders } = getLegacyEntraOAuthConfig({
			tenantId,
		});
		const urlParams = new URLSearchParams();

		urlParams.append('code', connectionInfo?.externalBrowserQuery?.code || '');
		urlParams.append('client_id', productionClientId);
		urlParams.append('redirect_uri', buildRedirectUri({ connectionInfo }));
		urlParams.append('grant_type', 'authorization_code');
		urlParams.append('code_verifier', connectionInfo?.proofKey);

		const response = await hckFetch(tokenEndpoint, {
			method: 'POST',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/x-www-form-urlencoded',
				...desktopTokenRequestHeaders,
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
		return exchangeAuthorizationCode({ connectionInfo, logger });
	}

	const { productionClientId, authorizationEndpoint, tokenEndpoint } = await oauth.getEntraIdOAuthConfig({
		tenantId: resolveAuthorizeTenant({ connectionInfo }),
	});
	const redirectPort = resolveExternalBrowserPort({ connectionInfo });
	const { accessToken } = await oauth.signInWithBrowser({
		authorizationEndpoint,
		tokenEndpoint,
		clientId: productionClientId,
		port: redirectPort,
		failOnPortConflict: false,
		authorizationQuery: getAuthorizationQuery({ connectionInfo }),
	});

	if (!accessToken) {
		throw new Error('Entra token response did not include an access token.');
	}

	return accessToken;
};

const isEntraMfa = ({ connectionInfo } = {}) => connectionInfo?.authMethod === 'Azure Active Directory (MFA)';

const canSignInWithStudio = ({ app, connectionInfo } = {}) => {
	if (!isEntraMfa({ connectionInfo })) {
		return false;
	}

	return Boolean(loadOauthModule({ app }));
};

const shouldUseExternalBrowser = ({ app, connectionInfo } = {}) =>
	isEntraMfa({ connectionInfo }) && !loadOauthModule({ app });

module.exports = {
	getMfaAccessToken,
	canSignInWithStudio,
	shouldUseExternalBrowser,
};
