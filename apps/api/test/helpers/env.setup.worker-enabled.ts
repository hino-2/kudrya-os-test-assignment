import { applyTestEnv } from './test-env.helper';

applyTestEnv();

// AppModule кэширует результат NestConfigModule.forRoot() на уровне статических метаданных класса
// при первом импорте — второй startApi() внутри того же файла/процесса не видит Object.assign(process.env, ...)
// в beforeAll. Поэтому WORKER_ENABLED=true форсируется здесь, в setupFiles, ДО импорта AppModule
// тестовым файлом — единственная точка, где переопределение env гарантированно попадает в конфиг.
process.env.WORKER_ENABLED = 'true';
