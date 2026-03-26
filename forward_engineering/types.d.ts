export type ColumnDefinition = {
	name: string;
	type: string;
	isActivated: boolean;
	length?: number;
	precision?: number;
	primaryKey?: boolean;
	scale?: number;
	timePrecision?: number;
	unique?: boolean;
	primaryKeyOptions?: { GUID: string; constraintName: string };
	uniqueKeyOptions?: Array<{ GUID: string; constraintName: string }>;
};

export type AppInstance = {
	require: (packageName: string) => unknown;
	general: object;
};

export type ConstraintDtoColumn = {
	name: string;
	isActivated: boolean;
};

export type KeyType = 'PRIMARY KEY' | 'UNIQUE';

export type ConstraintDto = {
	keyType: KeyType;
	name: string;
	columns?: ConstraintDtoColumn[];
};

export type JsonSchema = Record<string, unknown>;

export type Procedure = {
	name: string;
	orReplace: boolean;
	inputArgs: string;
	body: string;
	encryption?: string;
	recompile?: string;
	executeAs?: string;
	forReplication?: string;
	description?: string;
};
