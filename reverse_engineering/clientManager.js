const { getConnectionClient } = require('./databaseService/databaseService');

class ClientManager {
	#client = null;
	#sshService = null;
	#isSshTunnel = false;

	getClient() {
		return this.#client;
	}

	async initClient({ connectionInfo, sshService, attempts = 0, logger, app }) {
		if (!this.#sshService) {
			this.#sshService = sshService;
		}

		let connectionParams = { ...connectionInfo };

		if (connectionInfo.ssh && !this.#isSshTunnel) {
			const { options } = await sshService.openTunnel({
				sshAuthMethod: connectionInfo.ssh_method === 'privateKey' ? 'IDENTITY_FILE' : 'USER_PASSWORD',
				sshTunnelHostname: connectionInfo.ssh_host,
				sshTunnelPort: connectionInfo.ssh_port,
				sshTunnelUsername: connectionInfo.ssh_user,
				sshTunnelPassword: connectionInfo.ssh_password,
				sshTunnelIdentityFile: connectionInfo.ssh_key_file,
				sshTunnelPassphrase: connectionInfo.ssh_key_passphrase,
				host: connectionInfo.host,
				port: connectionInfo.port,
			});

			this.#isSshTunnel = true;

			connectionParams = {
				...connectionInfo,
				...options,
			};
		}

		try {
			this.#client = await getConnectionClient({ connectionInfo: connectionParams, logger, app });

			return this.#client;
		} catch (error) {
			const encryptConnection =
				connectionParams.encryptConnection === undefined || Boolean(connectionParams.encryptConnection);

			const isEncryptedConnectionToLocalInstance =
				error.message.includes('self signed certificate') && encryptConnection;

			if (isEncryptedConnectionToLocalInstance && attempts <= 0) {
				return this.initClient({
					connectionInfo: {
						...connectionParams,
						encryptConnection: false,
					},
					sshService,
					attempts: attempts + 1,
					logger,
					app,
				});
			}

			throw error;
		}
	}

	clearClient() {
		this.#client = null;

		if (this.#isSshTunnel && this.#sshService) {
			this.#sshService.closeConsumer();
			this.#isSshTunnel = false;
		}
	}
}

module.exports = {
	clientManager: new ClientManager(),
};
