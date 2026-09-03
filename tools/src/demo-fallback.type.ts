import type { FAIL_MODE, SCENARIO_MODE, SUPPLIER_CODE } from './demo-fallback.constants';

export type FailMode = (typeof FAIL_MODE)[keyof typeof FAIL_MODE];

export type ScenarioMode = (typeof SCENARIO_MODE)[keyof typeof SCENARIO_MODE];

export type SupplierCode = (typeof SUPPLIER_CODE)[keyof typeof SUPPLIER_CODE];
