const { URL } = require('url');
const { ConnectionPool } = require('mssql');

const mssqlPrefix = 'mssql://';
const sqlserverPrefix = 'jdbc:sqlserver://';

// example: mssql://username:password@host:1433/DatabaseName
const parseMssqlUrl = ({ url = '' }) => {
	const parsed = new URL(url);
	return {
		database: parsed.pathname.slice(1),
		host: parsed.hostname,
		port: parsed.port ? Number(parsed.port) : null,
		userName: parsed.username,
		userPassword: parsed.password,
	};
};

// example: jdbc:sqlserver://synapseworkspace.sql.azuresynapse.net:1433;databaseName=SampleDB;user=myusername@mytenant.onmicrosoft.com;password=myStrongPassword123;encrypt=true;trustServerCertificate=false;authentication=ActiveDirectoryPassword;loginTimeout=30;
const parseSqlServerUrl = ({ url = '' }) => {
	const [_protocol, params] = url.split(sqlserverPrefix);
	const [server, ...paramParts] = params.split(';');
	const [host, port] = server.split(':');

	const parsedParams = paramParts.reduce((acc, part) => {
		const [key, value] = part.split('=');
		if (key && value) {
			acc[key] = value;
		}
		return acc;
	}, {});

	return {
		server: host,
		port: port ? Number(port) : null,
		database: parsedParams.databaseName,
		user: parsedParams.user,
		password: parsedParams.password,
	};
};

// Default connection string example:
// Server=host,1433;Database=DatabaseName;User Id=username;Password=password;
const parseConnectionString = ({ string = '' }) => {
	let params;
	if (string.startsWith(sqlserverPrefix)) {
		params = parseSqlServerUrl({ url: string });
	} else if (string.startsWith(mssqlPrefix)) {
		params = parseMssqlUrl({ url: string });
	} else {
		params = ConnectionPool.parseConnectionString(string);
	}

	return {
		databaseName: params.database,
		host: params.server,
		port: params.port,
		userName: params.user,
		userPassword: params.password,
	};
};

module.exports = {
	parseConnectionString,
};