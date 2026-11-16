const removeBinaryValues = rows =>
	rows.map(row => {
		return Object.fromEntries(
			Object.entries(row).map(([key, value]) => [key, Buffer.isBuffer(value) ? null : value]),
		);
	});

module.exports = removeBinaryValues;
