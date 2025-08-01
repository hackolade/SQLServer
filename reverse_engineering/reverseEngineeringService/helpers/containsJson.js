const containsJson = ({ tableInfo }) =>
	tableInfo.some(item => {
		if (item['DATA_TYPE'] === 'json') {
			return true;
		}

		if (item['DATA_TYPE'] !== 'nvarchar') {
			return false;
		}

		return !(item['CHARACTER_MAXIMUM_LENGTH'] >= 0 && item['CHARACTER_MAXIMUM_LENGTH'] < 4000);
	});

module.exports = containsJson;
