import { applyTestEnv } from './test-env.helper';

applyTestEnv();

// та же причина, что в env.setup.worker-enabled.ts: ADMIN_API_ENABLED должен быть выставлен
// до первого импорта AppModule в процессе, иначе startApi(envOverrides) внутри теста опоздает.
process.env.ADMIN_API_ENABLED = 'false';
