const { ConnectionPool } = require('mssql');
const { URL } = require('url');

const mssqlPrefix = 'mssql://';
const sqlserverPrefix = 'jdbc:sqlserver://';

// example: mssql://username:password@host:1433/DatabaseName
const parseMssqlUrl = ({ url = '' }) => {
	const parsed = new URL(url);
	return {
		host: parsed.hostname,
		port: parsed.port ? Number(parsed.port) : null,
		databaseName: parsed.pathname.slice(1),
		userName: parsed.username,
		userPassword: parsed.password,
	};
};

// example: jdbc:sqlserver://synapseworkspace.sql.azuresynapse.net:1433;databaseName=SampleDB;user=myusername@mytenant.onmicrosoft.com;password=myStrongPassword123;encrypt=true;trustServerCertificate=false;authentication=ActiveDirectoryPassword;loginTimeout=30;
const parseSqlServerUrl = ({ url = '' }) => {
	const [_protocol, urlParams] = url.split(sqlserverPrefix);
	const [server, ...paramParts] = urlParams.split(';');
	const [host, port] = server.split(':');

	const params = paramParts.reduce((acc, part) => {
		const [key, value] = part.split('=');
		if (key && value) {
			acc[key] = value;
		}
		return acc;
	}, {});

	return {
		host,
		port: port ? Number(port) : null,
		databaseName: params.databaseName || params.database,
		userName: params.user,
		userPassword: params.password,
	};
};

// example: Server=tcp:synapseworkspace.sql.azuresynapse.net,1433;Database=SampleDB;Authentication=Active Directory Password;User ID=myusername@mytenant.onmicrosoft.com;Password=password;Encrypt=true;TrustServerCertificate=false;Connection Timeout=30;
const parseBasicString = ({ string = '' }) => {
	const parsed = ConnectionPool.parseConnectionString(string);

	const serverRegex = /Server=(?:[a-z]+:)?([^,;]+)(?:,\d+)?/i;
	const match = serverRegex.exec(string);
	const host = match ? match[1] : parsed.server;

	return {
		host: host,
		port: host.includes('\\') ? null : parsed.port,
		databaseName: parsed.database,
		userName: parsed.user,
		userPassword: parsed.password,
	};
};

const parseConnectionString = ({ string = '' }) => {
	if (string.startsWith(sqlserverPrefix)) {
		return parseSqlServerUrl({ url: string });
	} else if (string.startsWith(mssqlPrefix)) {
		return parseMssqlUrl({ url: string });
	} else {
		return parseBasicString({ string });
	}
};

module.exports = {
	parseConnectionString,
};
