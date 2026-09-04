import { applyTestEnv } from './test-env.helper';

applyTestEnv();

// та же причина, что в env.setup.worker-enabled.ts: пустой ADMIN_TOKEN отключает проверку токена
// в AdminTokenGuard (guardDisabled) и должен быть выставлен до первого импорта AppModule.
process.env.ADMIN_TOKEN = '';
