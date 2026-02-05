const _ = require('lodash');

const checkFieldPropertiesChanged = (compMod, propertiesToCheck) => {
	return propertiesToCheck.some(prop => compMod?.oldField[prop] !== compMod?.newField[prop]);
};

const modifyGroupItems = ({ data, key, hydrate, drop, create }) => {
	const compMod = getCompMod(data);
	const parentName = data.code || data.name || data.collectionName;

	const { removed, added, modified } = getModifiedGroupItems(compMod[key] || {}, hydrate);

	const removedScripts = removed.map(item => drop(parentName, item));
	const addedScripts = added.map(item => create(parentName, item));
	const modifiedScripts = modified.map(item => create(parentName, { ...item, orReplace: true }));

	return [modifiedScripts].flat().concat(removedScripts).concat(addedScripts);
};

const getModifiedGroupItems = ({ new: newItems = [], old: oldItems = [] }, hydrate) => {
	const oldHydrated = oldItems.map(element => hydrate(element)).filter(Boolean);
	const newHydrated = newItems.map(element => hydrate(element)).filter(Boolean);

	const { removed, added, modified } = oldHydrated.reduce(
		(accumulator, oldItem) => {
			const newItem = newHydrated.find(item => item.name === oldItem.name);
			const itemsAreNotEqual = !isGroupItemsEqual(newItem, oldItem);

			if (!newItem) {
				return {
					removed: [...accumulator.removed, oldItem],
					modified: accumulator.modified,
					added: accumulator.added,
				};
			}

			if (itemsAreNotEqual) {
				return {
					removed: accumulator.removed,
					modified: [...accumulator.modified, newItem],
					added: accumulator.added,
				};
			}

			return accumulator;
		},
		{
			removed: [],
			modified: [],
			added: newHydrated.filter(newItem => !oldHydrated.some(item => item.name === newItem.name)),
		},
	);

	return { removed, added, modified };
};

const isGroupItemsEqual = (leftItem, rightItem) => _.isEqual(leftItem, rightItem);

const getCompMod = containerData => containerData.role?.compMod ?? {};

const checkCompModEqual = ({ new: newItem, old: oldItem } = {}) => _.isEqual(newItem, oldItem);

const setIndexKeys = (idToNameHashTable, idToActivatedHashTable, index) => {
	return {
		...index,
		indxKey:
			index.indxKey?.map(key => ({
				...key,
				name: idToNameHashTable[key.keyId],
				isActivated: idToActivatedHashTable[key.keyId],
			})) || [],
		indxInclude: index.indxInclude?.map(key => ({
			...key,
			name: idToNameHashTable[key.keyId],
			isActivated: idToActivatedHashTable[key.keyId],
		})),
		indxIncludedColumn: index.indxIncludedColumn?.map(key => ({
			...key,
			name: idToNameHashTable[key.keyId],
			isActivated: idToActivatedHashTable[key.keyId],
		})),
	};
};

module.exports = {
	checkFieldPropertiesChanged,
	getCompMod,
	modifyGroupItems,
	checkCompModEqual,
	setIndexKeys,
};
