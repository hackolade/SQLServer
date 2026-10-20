'use strict';

const { registerHooks } = require('node:module');
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

globalThis.entraMfaFetch = async () => {
	throw new Error('hckFetch should not be called');
};

registerHooks({
	load(url, context, nextLoad) {
		if (!url.includes('@hackolade/fetch')) {
			return nextLoad(url, context);
		}

		return {
			format: 'commonjs',
			source: 'exports.hckFetch = (...args) => globalThis.entraMfaFetch(...args);',
			shortCircuit: true,
		};
	},
});

const { getMfaAccessToken } = require('./mfaAccessToken');

const ENTRA_CLIENT_ID = '0dc36597-bc44-49f8-a4a7-ae5401959b85';
const OAUTH_NOT_EXPOSED_MESSAGE = 'The module @hackolade/oauth is not exposed by the application to the plugins!';

describe('getMfaAccessToken', { concurrency: false }, () => {
	it('asks Studio for a user-to-machine token with the Entra authorize request', async () => {
		const calls = [];
		const app = {
			require(name) {
				assert.equal(name, '@hackolade/oauth');

				return {
					async getUserToMachineAccessToken(options) {
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
				failOnPortConflict: true,
				authorizationQuery: {
					prompt: 'select_account',
					response_mode: 'query',
					resource: 'https://database.windows.net/',
					login_hint: 'user name@example.com',
				},
				headers: {
					Origin: 'http://localhost',
				},
			},
		]);
	});

	it('uses the control-plane tenant when the connection tenant is empty and omits a missing login hint', async () => {
		const calls = [];
		const app = {
			require() {
				return {
					async getUserToMachineAccessToken(options) {
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
					async getUserToMachineAccessToken(options) {
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
					async getUserToMachineAccessToken() {
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
					async getUserToMachineAccessToken() {
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
