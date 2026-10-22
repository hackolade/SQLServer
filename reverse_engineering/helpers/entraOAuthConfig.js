'use strict';

const OAUTH_MODULE = '@hackolade/oauth';
const OAUTH_NOT_EXPOSED_MESSAGE = `The module ${OAUTH_MODULE} is not exposed by the application to the plugins!`;
const FALLBACK_PRODUCTION_CLIENT_ID = '0dc36597-bc44-49f8-a4a7-ae5401959b85';
const FALLBACK_TOKEN_ENDPOINT = 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token';
const FALLBACK_AUTHORIZE_ENDPOINT = 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize';
const FALLBACK_DESKTOP_TOKEN_REQUEST_HEADERS = { Origin: 'http://localhost' };

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

const resolveAuthorizeTenant = ({ connectionInfo = {} } = {}) =>
	connectionInfo.connectionTenantId || connectionInfo.tenantId || 'common';

const getLegacyEntraOAuthConfig = ({ tenantId } = {}) => ({
	productionClientId: FALLBACK_PRODUCTION_CLIENT_ID,
	authorizationEndpoint: tenantId
		? `https://login.microsoftonline.com/${tenantId}/oauth2/authorize`
		: FALLBACK_AUTHORIZE_ENDPOINT,
	tokenEndpoint: FALLBACK_TOKEN_ENDPOINT,
	desktopTokenRequestHeaders: FALLBACK_DESKTOP_TOKEN_REQUEST_HEADERS,
});

const getEntraOAuthConfig = ({ app, tenantId } = {}) => {
	const oauth = loadOauthModule({ app });

	if (!oauth) {
		return getLegacyEntraOAuthConfig({ tenantId });
	}

	return oauth.getEntraIdOAuthConfig(tenantId === undefined ? {} : { tenantId });
};

module.exports = {
	loadOauthModule,
	resolveAuthorizeTenant,
	getEntraOAuthConfig,
};
