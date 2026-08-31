import type { FULFILLMENT_MODE, PRODUCT_TYPE } from './catalog.constants';

export type ProductType = (typeof PRODUCT_TYPE)[keyof typeof PRODUCT_TYPE];

export type FulfillmentMode = (typeof FULFILLMENT_MODE)[keyof typeof FULFILLMENT_MODE];
