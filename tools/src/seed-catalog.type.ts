import type { SEED_FULFILLMENT_MODE, SEED_PRODUCT_TYPE } from './seed-catalog.constants';

export type SeedProductType = (typeof SEED_PRODUCT_TYPE)[keyof typeof SEED_PRODUCT_TYPE];

export type SeedFulfillmentMode = (typeof SEED_FULFILLMENT_MODE)[keyof typeof SEED_FULFILLMENT_MODE];
