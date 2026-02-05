/**
 * @typedef {import('./types').AppInstance} AppInstance
 * @typedef {import('./types').ColumnDefinition} ColumnDefinition
 * @typedef {import('./types').JsonSchema} JsonSchema
 * @typedef {import('./types').ConstraintDto} ConstraintDto
 */
const { toLower, toUpper } = require('lodash');

const types = require('./configs/types');
const defaultTypes = require('./configs/defaultTypes');
const getKeyHelper = require('./helpers/keyHelper');
const getColumnDefinitionHelper = require('./helpers/columnDefinitionHelper');

class DbtProvider {
	/**
	 * @type {AppInstance}
	 */
	#appInstance;

	/**
	 * @param {{ appInstance: AppInstance }}
	 */
	constructor({ appInstance }) {
		this.#appInstance = appInstance;
	}

	/**
	 * @param {{ appInstance }}
	 * @returns {DbtProvider}
	 */
	static createDbtProvider({ appInstance }) {
		return new DbtProvider({ appInstance });
	}

	/**
	 * @param {string} type
	 * @returns {string | undefined}
	 */
	getDefaultType(type) {
		return defaultTypes[type];
	}

	/**
	 * @returns {Record<string, object>}
	 */
	getTypesDescriptors() {
		return types;
	}

	/**
	 * @param {string} type
	 * @returns {boolean}
	 */
	hasType(type) {
		return Object.keys(types)
			.map(element => toLower(element))
			.includes(toLower(type));
	}

	/**
	 * @param {{ type: string; columnDefinition: ColumnDefinition }}
	 * @returns {string}
	 */
	decorateType({ type, columnDefinition }) {
		const columnDefinitionHelper = getColumnDefinitionHelper(this.#appInstance);

		return columnDefinitionHelper.decorateType(toUpper(type), columnDefinition);
	}

	/**
	 * @param {{ jsonSchema: JsonSchema }}
	 * @returns {ConstraintDto[]}
	 */
	getCompositeKeyConstraints({ jsonSchema }) {
		const keyHelper = getKeyHelper(this.#appInstance);

		return keyHelper.getCompositeKeyConstraints({ jsonSchema });
	}

	/**
	 * @param {{ columnDefinition: ColumnDefinition; jsonSchema: JsonSchema }}
	 * @returns {ConstraintDto[]}
	 */
	getColumnConstraints({ columnDefinition, jsonSchema }) {
		const keyHelper = getKeyHelper(this.#appInstance);

		return keyHelper.getColumnConstraints({ columnDefinition });
	}
}

module.exports = DbtProvider;
