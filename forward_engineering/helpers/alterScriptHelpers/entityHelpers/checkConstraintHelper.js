'use strict';

const { AlterScriptDto } = require('../types/AlterScriptDto');

/**
 * @typedef {{
 *     id: string,
 *     chkConstrName: string,
 *     constrExpression: string,
 * }} CheckConstraint
 *
 * @typedef {{
 *     old?: CheckConstraint,
 *     new?: CheckConstraint
 * }} CheckConstraintHistoryEntry
 * */

/**
 * @return {(collection: AlterCollectionDto) => Array<CheckConstraintHistoryEntry>}
 * */
const mapCheckConstraintNamesToChangeHistory = _ => collection => {
	const checkConstraintHistory = collection?.compMod?.chkConstr;
	if (!checkConstraintHistory) {
		return [];
	}
	const newConstraints = checkConstraintHistory.new || [];
	const oldConstraints = checkConstraintHistory.old || [];
	const constrNames = _.chain([...newConstraints, ...oldConstraints])
		.map(constr => constr.chkConstrName)
		.uniq()
		.value();

	return constrNames.map(chkConstrName => {
		return {
			old: _.find(oldConstraints, { chkConstrName }),
			new: _.find(newConstraints, { chkConstrName }),
		};
	});
};

/**
 * @return {(constraintHistory: Array<CheckConstraintHistoryEntry>, fullTableName: string) => Array<AlterScriptDto>}
 * */
const getDropCheckConstraintScriptDtos = (_, ddlProvider) => (constraintHistory, fullTableName) => {
	const { wrapInBrackets } = require('../../../utils/general')(_);

	return constraintHistory
		.filter(historyEntry => historyEntry.old && !historyEntry.new)
		.map(historyEntry => {
			const wrappedConstraintName = wrapInBrackets(historyEntry.old.chkConstrName);

			return AlterScriptDto.getInstance(
				[ddlProvider.dropConstraint(fullTableName, wrappedConstraintName)],
				true,
				true,
			);
		});
};

/**
 * @return {(constraintHistory: Array<CheckConstraintHistoryEntry>, fullTableName: string) => Array<AlterScriptDto>}
 * */
const getAddCheckConstraintScriptDtos = (_, ddlProvider) => (constraintHistory, fullTableName) => {
	const { wrapInBrackets } = require('../../../utils/general')(_);

	return constraintHistory
		.filter(historyEntry => historyEntry.new && !historyEntry.old)
		.map(historyEntry => {
			const { chkConstrName, constrCheck, constrExpression } = historyEntry.new;
			return ddlProvider.addCheckConstraint(
				fullTableName,
				wrapInBrackets(chkConstrName),
				constrExpression,
				constrCheck,
			);
		})
		.map(script => AlterScriptDto.getInstance([script], true, false));
};

/**
 * @return {(constraintHistory: Array<CheckConstraintHistoryEntry>, fullTableName: string) => Array<AlterScriptDto>}
 * */
const getUpdateCheckConstraintScriptDtos = (_, ddlProvider) => (constraintHistory, fullTableName) => {
	const { wrapInBrackets } = require('../../../utils/general')(_);

	return constraintHistory
		.filter(historyEntry => {
			if (historyEntry.old && historyEntry.new) {
				const oldExpression = historyEntry.old.constrExpression;
				const newExpression = historyEntry.new.constrExpression;
				const oldName = historyEntry.old.chkConstrName;
				const newName = historyEntry.new.chkConstrName;
				const hasOnlyNameChanged = oldExpression === newName && newName !== oldName;

				return oldExpression !== newExpression || hasOnlyNameChanged;
			}
			return false;
		})
		.map(historyEntry => {
			const { chkConstrName: oldConstrainName } = historyEntry.old;
			const dropConstraintScript = ddlProvider.dropConstraint(fullTableName, wrapInBrackets(oldConstrainName));
			const {
				chkConstrName: newConstrainName,
				constrCheck,
				constrExpression: newConstraintExpression,
			} = historyEntry.new;
			const addConstraintScript = ddlProvider.addCheckConstraint(
				fullTableName,
				wrapInBrackets(newConstrainName),
				newConstraintExpression,
				constrCheck,
			);

			return [
				AlterScriptDto.getInstance([dropConstraintScript], true, true),
				AlterScriptDto.getInstance([addConstraintScript], true, false),
			];
		})
		.flat();
};

/**
 * @return {(collection: AlterCollectionDto) => Array<AlterScriptDto>}
 * */
const getModifyCheckConstraintScriptDtos = (_, ddlProvider) => collection => {
	const { getFullTableName } = require('../../../utils/general')(_);
	const fullTableName = getFullTableName(collection);
	const constraintHistory = mapCheckConstraintNamesToChangeHistory(_)(collection);

	const addCheckConstraintScripts = getAddCheckConstraintScriptDtos(_, ddlProvider)(constraintHistory, fullTableName);
	const dropCheckConstraintScripts = getDropCheckConstraintScriptDtos(_, ddlProvider)(
		constraintHistory,
		fullTableName,
	);
	const updateCheckConstraintScripts = getUpdateCheckConstraintScriptDtos(_, ddlProvider)(
		constraintHistory,
		fullTableName,
	);

	return [...dropCheckConstraintScripts, ...addCheckConstraintScripts, ...updateCheckConstraintScripts];
};

module.exports = {
	getModifyCheckConstraintScriptDtos,
};
