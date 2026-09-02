import {
  TEST_HOST,
  TEST_WORKER_SUPPLIER_A_PORT,
  TEST_WORKER_SUPPLIER_B_PORT,
  TEST_WORKER_SUPPLIER_REQUEST_TIMEOUT_MS,
} from './harness.constants';
import { applyTestEnv } from './test-env.helper';

applyTestEnv();

// AppModule кэширует результат NestConfigModule.forRoot() на уровне статических метаданных класса
// при первом импорте — второй startApi() внутри того же файла/процесса не видит Object.assign(process.env, ...)
// в beforeAll. Поэтому WORKER_ENABLED=true форсируется здесь, в setupFiles, ДО импорта AppModule
// тестовым файлом — единственная точка, где переопределение env гарантированно попадает в конфиг.
process.env.WORKER_ENABLED = 'true';

// та же причина, что и для WORKER_ENABLED: SUPPLIER_A_BASE_URL/SUPPLIER_B_BASE_URL/
// SUPPLIER_REQUEST_TIMEOUT_MS, переданные в startApi(envOverrides) из beforeAll теста, приходят
// СЛИШКОМ ПОЗДНО — AppModule уже импортирован (и NestConfigModule.forRoot() уже выполнился)
// к моменту, когда top-level import самого спека подтягивает app.harness.ts. Поэтому базовые
// URL заглушек фиксируются здесь на заранее известных портах, а startStub() в спеках слушает
// именно эти порты (см. TEST_WORKER_SUPPLIER_A_PORT/B_PORT в harness.constants.ts). 150мс
// намеренно меньше STUB_HANG_MS заглушки (по умолчанию 6000мс), чтобы клиент гарантированно
// поймал client-side timeout до того, как заглушка сама ответила бы на зависший запрос.
process.env.SUPPLIER_A_BASE_URL = `http://${TEST_HOST}:${TEST_WORKER_SUPPLIER_A_PORT}`;
process.env.SUPPLIER_B_BASE_URL = `http://${TEST_HOST}:${TEST_WORKER_SUPPLIER_B_PORT}`;
process.env.SUPPLIER_REQUEST_TIMEOUT_MS = String(TEST_WORKER_SUPPLIER_REQUEST_TIMEOUT_MS);
