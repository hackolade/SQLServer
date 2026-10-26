'use strict';

const { registerHooks } = require('node:module');
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

globalThis.entraMfaFetch = async () => {
	throw new Error('hckFetch should not be called');
};

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier !== '@hackolade/fetch') {
			return nextResolve(specifier, context);
		}

		return {
			url: 'file:///hackolade-fetch-stub',
			shortCircuit: true,
		};
	},
	load(url, context, nextLoad) {
		if (url !== 'file:///hackolade-fetch-stub') {
			return nextLoad(url, context);
		}

		return {
			format: 'commonjs',
			source: 'exports.hckFetch = (...args) => globalThis.entraMfaFetch(...args);',
			shortCircuit: true,
		};
	},
});

const { getMfaAccessToken, canSignInWithStudio, shouldUseExternalBrowser } = require('./mfaAccessToken');

const ENTRA_CLIENT_ID = '0dc36597-bc44-49f8-a4a7-ae5401959b85';
const OAUTH_NOT_EXPOSED_MESSAGE = 'The module @hackolade/oauth is not exposed by the application to the plugins!';

const getEntraIdOAuthConfig = ({ tenantId } = {}) => ({
	productionClientId: ENTRA_CLIENT_ID,
	testingClientId: 'f28311c1-422d-4c77-8bbb-ff2fa1b84b7a',
	authorizationEndpoint: tenantId
		? `https://login.microsoftonline.com/${tenantId}/oauth2/authorize`
		: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
	tokenEndpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
	adminConsentBase: 'https://login.microsoftonline.com/organizations/adminconsent',
	desktopTokenRequestHeaders: { Origin: 'http://localhost' },
});

describe('getMfaAccessToken', { concurrency: false }, () => {
	it('asks Studio for a user-to-machine token with the Entra authorize request', async () => {
		const calls = [];
		const app = {
			require(name) {
				assert.equal(name, '@hackolade/oauth');

				return {
					getEntraIdOAuthConfig,
					async signInWithBrowser(options) {
						calls.push(options);

						return { accessToken: 'sql-access-token' };
					},
				};
			},
		};

		const token = await getMfaAccessToken({
			app,
			connectionInfo: {
				connectionTenantId: 'saved-directory',
				tenantId: 'control-plane-tenant',
				loginHint: 'user name@example.com',
			},
			logger: { log() {} },
		});

		assert.equal(token, 'sql-access-token');
		assert.equal('scope' in calls[0], false);
		assert.deepEqual(calls, [
			{
				authorizationEndpoint: 'https://login.microsoftonline.com/saved-directory/oauth2/authorize',
				tokenEndpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
				clientId: ENTRA_CLIENT_ID,
				port: 8080,
				failOnPortConflict: false,
				authorizationQuery: {
					prompt: 'select_account',
					response_mode: 'query',
					resource: 'https://database.windows.net/',
					login_hint: 'user name@example.com',
				},
			},
		]);
	});

	it('uses externalBrowserPort from the connection for signInWithBrowser', async () => {
		const calls = [];
		const app = {
			require() {
				return {
					getEntraIdOAuthConfig,
					async signInWithBrowser(options) {
						calls.push(options);

						return { accessToken: 'sql-access-token' };
					},
				};
			},
		};

		await getMfaAccessToken({
			app,
			connectionInfo: { externalBrowserPort: 8082 },
			logger: { log() {} },
		});

		assert.equal(calls[0].port, 8082);
	});

	it('uses the control-plane tenant when the connection tenant is empty and omits a missing login hint', async () => {
		const calls = [];
		const app = {
			require() {
				return {
					getEntraIdOAuthConfig,
					async signInWithBrowser(options) {
						calls.push(options);

						return { accessToken: 'sql-access-token' };
					},
				};
			},
		};

		await getMfaAccessToken({
			app,
			connectionInfo: {
				connectionTenantId: '',
				tenantId: 'control-plane-tenant',
			},
			logger: { log() {} },
		});

		assert.equal(
			calls[0].authorizationEndpoint,
			'https://login.microsoftonline.com/control-plane-tenant/oauth2/authorize',
		);
		assert.deepEqual(calls[0].authorizationQuery, {
			prompt: 'select_account',
			response_mode: 'query',
			resource: 'https://database.windows.net/',
		});
	});

	it('uses the common tenant when no tenant id is set', async () => {
		const calls = [];
		const app = {
			require() {
				return {
					getEntraIdOAuthConfig,
					async signInWithBrowser(options) {
						calls.push(options);

						return { accessToken: 'sql-access-token' };
					},
				};
			},
		};

		await getMfaAccessToken({
			app,
			connectionInfo: {},
			logger: { log() {} },
		});

		assert.equal(calls[0].authorizationEndpoint, 'https://login.microsoftonline.com/common/oauth2/authorize');
	});

	it('rejects when Studio does not return an access token', async () => {
		const app = {
			require() {
				return {
					getEntraIdOAuthConfig,
					async signInWithBrowser() {
						return {};
					},
				};
			},
		};

		await assert.rejects(
			() =>
				getMfaAccessToken({
					app,
					connectionInfo: { connectionTenantId: 'saved-directory' },
					logger: { log() {} },
				}),
			{ message: 'Entra token response did not include an access token.' },
		);
	});

	it('rejects when loading the OAuth module fails for another reason', async () => {
		const failure = new Error('oauth crashed');
		const app = {
			require() {
				throw failure;
			},
		};

		await assert.rejects(
			() =>
				getMfaAccessToken({
					app,
					connectionInfo: {},
					logger: { log() {} },
				}),
			error => error === failure,
		);
	});

	it('rejects when the OAuth module fails to return a token', async () => {
		const failure = new Error('Entra rejected the login');
		const app = {
			require() {
				return {
					getEntraIdOAuthConfig,
					async signInWithBrowser() {
						throw failure;
					},
				};
			},
		};

		await assert.rejects(
			() =>
				getMfaAccessToken({
					app,
					connectionInfo: {},
					logger: { log() {} },
				}),
			error => error === failure,
		);
	});

	it('exchanges the authorization code and proof key when the OAuth module is not exposed', async () => {
		const requests = [];
		globalThis.entraMfaFetch = async (url, options) => {
			requests.push({ url, body: String(options.body) });

			return {
				status: 200,
				json: async () => ({ access_token: 'exchanged-token' }),
			};
		};
		const app = {
			require() {
				throw new Error(OAUTH_NOT_EXPOSED_MESSAGE);
			},
		};

		const token = await getMfaAccessToken({
			app,
			connectionInfo: {
				externalBrowserQuery: { code: 'auth-code' },
				proofKey: 'proof-key',
			},
			logger: { log() {} },
		});

		assert.equal(token, 'exchanged-token');
		assert.deepEqual(requests, [
			{
				url: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
				body: 'code=auth-code&client_id=0dc36597-bc44-49f8-a4a7-ae5401959b85&redirect_uri=http%3A%2F%2Flocalhost%3A8080&grant_type=authorization_code&code_verifier=proof-key',
			},
		]);
	});

	it('logs a code exchange failure and returns an empty token', async () => {
		const failure = new Error('network down');
		const entries = [];
		globalThis.entraMfaFetch = async () => {
			throw failure;
		};
		const app = {
			require() {
				throw new Error(OAUTH_NOT_EXPOSED_MESSAGE);
			},
		};

		const token = await getMfaAccessToken({
			app,
			connectionInfo: {
				externalBrowserQuery: { code: 'auth-code' },
				proofKey: 'proof-key',
			},
			logger: {
				log(level, data, message) {
					entries.push({ level, data, message });
				},
			},
		});

		assert.equal(token, '');
		assert.deepEqual(entries, [
			{
				level: 'error',
				data: { message: 'network down', stack: failure.stack, error: failure },
				message: 'MFA auth error',
			},
		]);
	});
});

describe('canSignInWithStudio', { concurrency: false }, () => {
	const mfaConnectionInfo = { authMethod: 'Azure Active Directory (MFA)' };

	it('uses the user-to-machine call when the OAuth module is present', () => {
		const app = {
			require() {
				return {};
			},
		};

		assert.equal(canSignInWithStudio({ app, connectionInfo: mfaConnectionInfo }), true);
	});

	it('keeps the external browser when the OAuth module is not exposed', () => {
		const app = {
			require() {
				throw new Error(OAUTH_NOT_EXPOSED_MESSAGE);
			},
		};

		assert.equal(canSignInWithStudio({ app, connectionInfo: mfaConnectionInfo }), false);
	});
});

describe('shouldUseExternalBrowser', { concurrency: false }, () => {
	const mfaConnectionInfo = { authMethod: 'Azure Active Directory (MFA)' };

	it('opens SQL when the OAuth module is present', () => {
		const app = {
			require() {
				return {};
			},
		};

		assert.equal(shouldUseExternalBrowser({ app, connectionInfo: mfaConnectionInfo }), false);
	});

	it('keeps the external browser when the OAuth module is not exposed', () => {
		const app = {
			require() {
				throw new Error(OAUTH_NOT_EXPOSED_MESSAGE);
			},
		};

		assert.equal(shouldUseExternalBrowser({ app, connectionInfo: mfaConnectionInfo }), true);
	});

	it('surfaces any other failure while loading the OAuth module', () => {
		const failure = new Error('oauth crashed');
		const app = {
			require() {
				throw failure;
			},
		};

		assert.throws(
			() => shouldUseExternalBrowser({ app, connectionInfo: mfaConnectionInfo }),
			error => error === failure,
		);
	});
});
